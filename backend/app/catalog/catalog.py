from decimal import Decimal, InvalidOperation

from flask import Blueprint, request
import pymysql

from app.access_data import AccessData
from app.security import requiere_rol

catalog = Blueprint('catalog', __name__)

# Same values as the ENUM in the products table
UNIDADES_BASE = ('unidad', 'lb', 'm')


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


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


def _product_to_json(product):
    """Decimals and tinyint are not friendly for Angular: send numbers and true/false."""
    return {
        **product,
        "precio": float(product["precio"]),
        "stock_minimo": float(product["stock_minimo"]) if product["stock_minimo"] is not None else None,
        "activo": bool(product["activo"]),
    }


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

    # categoria_id is optional, but if it comes it must exist
    if categoria_id is not None:
        if isinstance(categoria_id, bool) or not isinstance(categoria_id, int):
            return _error("categoria_id must be an integer")
        if not access.category_exists(categoria_id):
            return _error("categoria_id does not exist", 404)

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


@catalog.route('api/v1/categories', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_categories():
    return {
        "status": 0,
        "message": "SUCCESS: categories",
        "data": AccessData().get_categories(),
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
