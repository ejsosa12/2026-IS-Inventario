from decimal import Decimal, InvalidOperation

from flask import Blueprint, g, request
import pymysql

from app.access_data import AccessData
from app.security import requiere_rol

catalog = Blueprint('catalog', __name__)

# Same values as the ENUM in the products table
UNIDADES_BASE = ('unidad', 'lb', 'm', 'gal')


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def _check_category(access, categoria_id, keep_id=None):
    """HU-05: categoria_id is required and must be an active category.

    keep_id is the product's current category (on edit): keeping it is fine even if inactive.
    Returns an error response, or None when it is fine.
    """
    if categoria_id is None:
        return _error("categoria_id is required")
    if isinstance(categoria_id, bool) or not isinstance(categoria_id, int):
        return _error("categoria_id must be an integer")
    category = access.get_category_by_id(categoria_id)
    if category is None:
        return _error("categoria_id does not exist", 404)
    if not category["activo"] and categoria_id != keep_id:
        return _error("categoria_id is inactive")
    return None


def _to_decimal(value):
    """Converts a JSON number (or numeric string) to Decimal. Returns None if it is not a number."""
    # bool is a subclass of int in Python: true would become 1
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _float_or_none(value):
    return float(value) if value is not None else None


def _product_to_json(product):
    """Decimals and tinyint are not friendly for Angular: send numbers and true/false."""
    data = {
        **product,
        "precio": float(product["precio"]),
        "stock_minimo": _float_or_none(product["stock_minimo"]),
        "activo": bool(product["activo"]),
    }
    # Only in the owner's queries (HU-02, HU-29): the product list does not carry it
    if "precio_compra" in product:
        data["precio_compra"] = _float_or_none(product["precio_compra"])
    return data


def _history_to_json(change):
    return {
        **change,
        "precio_anterior": _float_or_none(change["precio_anterior"]),
        "precio_nuevo": float(change["precio_nuevo"]),
        "fecha": change["fecha"].isoformat(),
    }


def _decimals_ok(value, places):
    """True if value has at most that many decimals (precio is decimal(10,2), precio_compra (12,4))."""
    return value == value.quantize(Decimal(1).scaleb(-places))


def _presentation_to_json(presentation):
    return {**presentation, "factor": float(presentation["factor"])}


def _validate_presentations(raw, unidad_base):
    """HU-06: checks the "1 caja = 50 lb" list of a new product.

    Returns (presentations, None) when it is fine or (None, error response) when it is not.
    """
    if raw in (None, []):
        return [], None
    if not isinstance(raw, list):
        return None, _error("presentaciones must be a list")

    presentations = []
    seen = set()
    for position, item in enumerate(raw, start=1):
        prefix = f"presentacion {position}: "
        if not isinstance(item, dict):
            return None, _error(prefix + "invalid data")

        nombre = str(item.get("nombre") or "").strip()
        if not nombre:
            return None, _error(prefix + "nombre is required")
        if len(nombre) > 30:
            return None, _error(prefix + "nombre must have at most 30 characters")
        # Same rule as UNIQUE(producto_id, nombre), but "Caja" and "caja" also count as repeated
        if nombre.lower() in seen:
            return None, _error(prefix + f"'{nombre}' is repeated")
        seen.add(nombre.lower())

        factor = _to_decimal(item.get("factor"))
        if factor is None or factor <= 0:
            return None, _error(prefix + "factor must be greater than 0")
        # decimal(10,3): up to 3 decimals and less than 10 million
        if factor != factor.quantize(Decimal("0.001")) or factor >= Decimal("10000000"):
            return None, _error(prefix + "factor can have at most 3 decimals")
        # HU-07: a box of a product sold by unit holds a whole number of units
        if unidad_base == "unidad" and factor != factor.to_integral_value():
            return None, _error(prefix + "factor must be a whole number for products sold by unidad")

        presentations.append({"nombre": nombre, "factor": factor})
    return presentations, None


@catalog.route('api/v1/add-product', methods=['POST'])
@requiere_rol('admin')  # HU-29: only the owner manages the catalog
def add_product():
    body = request.get_json(silent=True)

    if not body:
        return _error("product data is required")

    codigo = str(body.get("codigo") or "").strip()
    nombre = str(body.get("nombre") or "").strip()
    unidad_base = body.get("unidad_base", "unidad")
    precio = _to_decimal(body.get("precio"))
    stock_minimo_raw = body.get("stock_minimo")
    categoria_id = body.get("categoria_id")

    # Required fields
    if not codigo:
        return _error("codigo is required")
    if len(codigo) > 30:
        return _error("codigo must have at most 30 characters")

    if not nombre:
        return _error("nombre is required")
    if len(nombre) > 100:
        return _error("nombre must have at most 100 characters")

    if precio is None:
        return _error("precio is required and must be a number")
    if precio < 0:
        return _error("precio cannot be negative")

    if unidad_base not in UNIDADES_BASE:
        return _error(f"unidad_base must be one of: {', '.join(UNIDADES_BASE)}")

    # HU-21: stock_minimo is optional. Empty = the product does not generate alerts
    stock_minimo = None
    if stock_minimo_raw not in (None, ""):
        stock_minimo = _to_decimal(stock_minimo_raw)
        if stock_minimo is None:
            return _error("stock_minimo must be a number")
        if stock_minimo < 0:
            return _error("stock_minimo cannot be negative")
        # HU-07: products sold by unit only accept whole numbers
        if unidad_base == 'unidad' and stock_minimo != stock_minimo.to_integral_value():
            return _error("stock_minimo must be a whole number for products sold by unidad")

    # HU-06: optional, how the product is bought ("1 caja = 50 lb")
    presentaciones, error = _validate_presentations(body.get("presentaciones"), unidad_base)
    if error:
        return error

    access = AccessData()

    # HU-05: every product belongs to an active category
    error = _check_category(access, categoria_id)
    if error:
        return error

    if access.product_code_exists(codigo):
        return _error(f"a product with codigo '{codigo}' already exists", 409)

    try:
        new_id = access.add_product(
            codigo, nombre, precio, unidad_base, stock_minimo, categoria_id, presentaciones
        )
    except pymysql.err.IntegrityError:
        # Two requests with the same codigo at the same time: the UNIQUE in the table stops the second one
        return _error(f"a product with codigo '{codigo}' already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: product created",
        "data": {
            **_product_to_json(access.get_product_by_id(new_id)),
            "presentaciones": [
                _presentation_to_json(p) for p in access.get_presentations_by_product(new_id)
            ],
        },
    }, 201


def _product_detail(access, product_id):
    """Everything the edit page needs (HU-21, HU-02), or None if the product does not exist."""
    product = access.get_product_by_id(product_id)
    if product is None:
        return None
    return {
        **_product_to_json(product),
        "presentaciones": [
            _presentation_to_json(p) for p in access.get_presentations_by_product(product_id)
        ],
        # If it already moved, its unit cannot change (the saved quantities would change meaning)
        "tiene_movimientos": access.product_has_movements(product_id),
        "historial_precios": [_history_to_json(h) for h in access.get_price_history(product_id)],
    }


@catalog.route('api/v1/products/<int:product_id>', methods=['GET'])
@requiere_rol('admin')  # HU-29: it shows the purchase price and the price history
def get_product(product_id):
    detail = _product_detail(AccessData(), product_id)
    if detail is None:
        return _error("product does not exist", 404)
    return {"status": 0, "message": "SUCCESS: product", "data": detail}, 200


@catalog.route('api/v1/edit-product/<int:product_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-02 / HU-29: only the owner changes prices and the catalog
def edit_product(product_id):
    """HU-21 (mínimo) and HU-02 (precios). Presentations and activo are not changed here."""
    body = request.get_json(silent=True)
    if not body:
        return _error("product data is required")

    access = AccessData()
    current = access.get_product_by_id(product_id)
    if current is None:
        return _error("product does not exist", 404)

    codigo = str(body.get("codigo") or "").strip()
    nombre = str(body.get("nombre") or "").strip()
    unidad_base = body.get("unidad_base", current["unidad_base"])
    categoria_id = body.get("categoria_id")

    if not codigo:
        return _error("codigo is required")
    if len(codigo) > 30:
        return _error("codigo must have at most 30 characters")
    if not nombre:
        return _error("nombre is required")
    if len(nombre) > 100:
        return _error("nombre must have at most 100 characters")

    # Sale price (per base unit), required, decimal(10,2)
    precio = _to_decimal(body.get("precio"))
    if precio is None:
        return _error("precio is required and must be a number")
    if precio < 0:
        return _error("precio cannot be negative")
    if not _decimals_ok(precio, 2) or precio >= Decimal("100000000"):
        return _error("precio can have at most 2 decimals")

    # HU-02: purchase price (per base unit). Each invoice updates it; the owner may correct it.
    # Empty is only allowed while the product has never had one
    precio_compra = None
    if body.get("precio_compra") not in (None, ""):
        precio_compra = _to_decimal(body.get("precio_compra"))
        if precio_compra is None:
            return _error("precio_compra must be a number")
        if precio_compra < 0:
            return _error("precio_compra cannot be negative")
        if not _decimals_ok(precio_compra, 4) or precio_compra >= Decimal("100000000"):
            return _error("precio_compra can have at most 4 decimals")
    elif current["precio_compra"] is not None:
        return _error("precio_compra cannot be removed once the product has one")

    if unidad_base not in UNIDADES_BASE:
        return _error(f"unidad_base must be one of: {', '.join(UNIDADES_BASE)}")
    if unidad_base != current["unidad_base"]:
        # 50 lb already entered would become "50 unidades"
        if access.product_has_movements(product_id):
            return _error("unidad_base cannot change: the product already has movements")
        # HU-07: a box of a product sold by unit holds a whole number of units
        if unidad_base == "unidad" and any(
            p["factor"] != p["factor"].to_integral_value()
            for p in access.get_presentations_by_product(product_id)
        ):
            return _error("unidad_base cannot be unidad: a presentation has a decimal factor")

    # HU-21: stock_minimo is optional. Empty = the product does not generate alerts
    stock_minimo = None
    if body.get("stock_minimo") not in (None, ""):
        stock_minimo = _to_decimal(body.get("stock_minimo"))
        if stock_minimo is None:
            return _error("stock_minimo must be a number")
        if stock_minimo < 0:
            return _error("stock_minimo cannot be negative")
        if not _decimals_ok(stock_minimo, 3):
            return _error("stock_minimo can have at most 3 decimals")
        # HU-07: products sold by unit only accept whole numbers
        if unidad_base == "unidad" and stock_minimo != stock_minimo.to_integral_value():
            return _error("stock_minimo must be a whole number for products sold by unidad")

    # HU-05: required; a product may keep its category even if it was deactivated
    error = _check_category(access, categoria_id, keep_id=current["categoria_id"])
    if error:
        return error

    if access.product_code_taken(codigo, product_id):
        return _error(f"a product with codigo '{codigo}' already exists", 409)

    fields = {
        "codigo": codigo, "nombre": nombre, "categoria_id": categoria_id,
        "unidad_base": unidad_base, "stock_minimo": stock_minimo,
        "precio": precio, "precio_compra": precio_compra,
    }
    try:
        access.update_product(product_id, fields, g.user["users"])
    except pymysql.err.IntegrityError:
        return _error(f"a product with codigo '{codigo}' already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: product updated",
        "data": _product_detail(access, product_id),
    }, 200


@catalog.route('api/v1/products', methods=['GET'])
@requiere_rol()  # any logged-in user (HU-19: employees also check stock)
def get_products():
    products = [
        {**_product_to_json(product), "existencia": float(product["existencia"])}
        for product in AccessData().get_products()
    ]
    return {
        "status": 0,
        "message": "SUCCESS: products",
        "data": products,
    }, 200


@catalog.route('api/v1/low-stock', methods=['GET'])
@requiere_rol()  # HU-22: everyone sees what is running out (no money involved)
def get_low_stock():
    data = []
    for product in AccessData().get_low_stock():
        existencia = product["existencia"]
        minimo = product["stock_minimo"]
        data.append({
            **product,
            "existencia": float(existencia),
            "stock_minimo": float(minimo),
            # What is missing to get back to the minimum (HU-23 will build on this)
            "faltan": float(minimo - existencia),
            "agotado": existencia <= 0,
        })
    return {
        "status": 0,
        "message": "SUCCESS: low stock",
        "data": data,
    }, 200


def _category_to_json(category):
    """activo comes from the DB as 0/1; Angular expects true/false."""
    return {**category, "activo": bool(category["activo"])}


def _read_category_name(body):
    """HU-05: validates the name for add and rename. Returns (nombre, error)."""
    raw = body.get("nombre") if isinstance(body, dict) else None
    # "  Pintura   y   barniz " -> "Pintura y barniz"
    nombre = " ".join(str(raw or "").split())
    if not nombre:
        return None, _error("nombre is required")
    if len(nombre) > 50:
        return None, _error("nombre must have at most 50 characters")
    return nombre, None


@catalog.route('api/v1/categories', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_categories():
    # HU-05: active and inactive; the product forms only offer the active ones
    return {
        "status": 0,
        "message": "SUCCESS: categories",
        "data": [_category_to_json(c) for c in AccessData().get_categories()],
    }, 200


@catalog.route('api/v1/add-category', methods=['POST'])
@requiere_rol('admin')  # HU-05: only the owner creates categories
def add_category():
    nombre, error = _read_category_name(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    if access.category_name_taken(nombre):
        return _error("a category with that nombre already exists", 409)
    try:
        new_id = access.add_category(nombre)
    except pymysql.err.IntegrityError:
        return _error("a category with that nombre already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: category created",
        "data": _category_to_json(access.get_category_by_id(new_id)),
    }, 201


@catalog.route('api/v1/edit-category/<int:category_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-05: only the owner renames categories
def edit_category(category_id):
    nombre, error = _read_category_name(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    if access.get_category_by_id(category_id) is None:
        return _error("category does not exist", 404)
    # Changing only upper/lower case of its own name is fine
    if access.category_name_taken(nombre, category_id):
        return _error("a category with that nombre already exists", 409)
    try:
        access.rename_category(category_id, nombre)
    except pymysql.err.IntegrityError:
        return _error("a category with that nombre already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: category renamed",
        "data": _category_to_json(access.get_category_by_id(category_id)),
    }, 200


@catalog.route('api/v1/category-status/<int:category_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-05: only the owner deactivates categories
def set_category_status(category_id):
    body = request.get_json(silent=True)
    activo = body.get("activo") if isinstance(body, dict) else None
    if not isinstance(activo, bool):
        return _error("activo must be true or false")

    access = AccessData()
    if access.get_category_by_id(category_id) is None:
        return _error("category does not exist", 404)

    # Soft delete: its products keep it, but new products cannot pick it
    access.set_category_active(category_id, activo)

    return {
        "status": 0,
        "message": "SUCCESS: category " + ("activated" if activo else "deactivated"),
        "data": _category_to_json(access.get_category_by_id(category_id)),
    }, 200


@catalog.route('api/v1/presentations', methods=['GET'])
@requiere_rol()  # any logged-in user (HU-11: employees pick the presentation when receiving)
def get_presentations():
    # HU-06: how each product is bought. Angular filters them by producto_id
    presentations = [_presentation_to_json(p) for p in AccessData().get_presentations()]
    return {
        "status": 0,
        "message": "SUCCESS: presentations",
        "data": presentations,
    }, 200


# ------------------------------------------------------------
# HU-26: how much money is in the store. Owner only (HU-29: money)
# ------------------------------------------------------------

@catalog.route('api/v1/inventory-value', methods=['GET'])
@requiere_rol('admin')
def get_inventory_value():
    """existencia × precio_compra per product, total per category and grand total.

    Products without a purchase price are left out of the totals and listed in sin_precio,
    so the owner knows the total is missing them (instead of counting them as Q0).
    """
    cents = Decimal("0.01")
    productos, sin_precio = [], []
    categorias = {}
    total = Decimal(0)

    for row in AccessData().get_stock_with_cost():
        precio = row["precio_compra"]
        valor = (row["existencia"] * precio).quantize(cents) if precio is not None else None
        product = {
            **row,
            "activo": bool(row["activo"]),
            "existencia": float(row["existencia"]),
            "precio_compra": float(precio) if precio is not None else None,
            "valor": float(valor) if valor is not None else None,
        }
        productos.append(product)

        category = categorias.setdefault(row["categoria_id"], {
            "categoria_id": row["categoria_id"],
            "categoria": row["categoria"],
            "productos": 0,
            "valor": Decimal(0),
            "sin_precio": 0,
        })
        category["productos"] += 1
        if valor is None:
            category["sin_precio"] += 1
            sin_precio.append(product)
        else:
            category["valor"] += valor
            total += valor

    por_categoria = sorted(categorias.values(), key=lambda c: c["valor"], reverse=True)
    for category in por_categoria:
        category["porcentaje"] = float(category["valor"] / total * 100) if total else 0.0
        category["valor"] = float(category["valor"])

    return {
        "status": 0,
        "message": "SUCCESS: inventory value",
        "data": {
            "total": float(total),
            "productos_con_existencia": len(productos),
            "por_categoria": por_categoria,
            # Most valuable first; the ones without price at the end
            "productos": sorted(productos, key=lambda p: (p["valor"] is None, -(p["valor"] or 0))),
            "sin_precio": sin_precio,
        },
    }, 200
