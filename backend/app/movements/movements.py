from datetime import date, datetime, time, timedelta
from decimal import Decimal

from flask import Blueprint, g, request
import pymysql

from app.access_data import AccessData, EntryAlreadyVoided, InsufficientStock, NegativeStock
from app.catalog.catalog import _to_decimal
from app.security import requiere_rol

movements = Blueprint('movements', __name__)

# Same precision as the columns in movements
CANTIDAD_DECIMALES = Decimal('0.001')  # decimal(10,3)
PRECIO_DECIMALES = Decimal('0.0001')   # decimal(12,4)


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def _entry_to_json(entry):
    """Dates as ISO text and Decimals as numbers, so Angular can read them."""
    data = {
        **entry,
        "fecha_factura": entry["fecha_factura"].isoformat(),
        "fecha": entry["fecha"].isoformat(),
        # HU-14: voided entries stay, marked with who, when and why
        "anulada": entry["anulada_en"] is not None,
        "anulada_en": entry["anulada_en"].isoformat() if entry["anulada_en"] else None,
    }
    if "con_faltantes" in entry:
        data["con_faltantes"] = bool(entry["con_faltantes"])
    if "productos" in entry:
        data["productos"] = [_item_to_json(item) for item in entry["productos"]]
    return data


def _item_to_json(item):
    """Sends the base unit values and also the values as they came on the invoice."""
    factor = item["factor"] or Decimal(1)
    return {
        **item,
        "factor": float(factor),
        "cantidad": float(item["cantidad"]),
        "cantidad_factura": float(item["cantidad_factura"]),
        "precio": float(item["precio"]),
        # HU-06: "2 cajas a Q400" instead of "100 lb a Q8"
        "cantidad_presentacion": float(item["cantidad"] / factor),
        "cantidad_factura_presentacion": float(item["cantidad_factura"] / factor),
        "precio_presentacion": float((item["precio"] * factor).quantize(Decimal('0.01'))),
        "faltante": item["cantidad_factura"] != item["cantidad"],
    }


def _validate_item(access, raw, position, keep_product_ids=()):
    """Checks one invoice line and converts it to the base unit.

    keep_product_ids: products of the entry being corrected (HU-14); they are accepted even if
    they were deactivated after the invoice arrived.
    Returns (item, None) when it is fine or (None, error response) when it is not.
    """
    prefix = f"producto {position}: "
    if not isinstance(raw, dict):
        return None, _error(prefix + "invalid data")

    producto_id = raw.get("producto_id")
    if not isinstance(producto_id, int) or isinstance(producto_id, bool):
        return None, _error(prefix + "producto_id is required")
    product = access.get_product_by_id(producto_id)
    if product is None:
        return None, _error(prefix + "product does not exist", 404)
    # HU-04: a product that was taken off the catalog does not receive stock
    if not product["activo"] and producto_id not in keep_product_ids:
        return None, _error(prefix + "product is not active")

    # HU-06: quantities and price come as on the invoice (2 cajas at Q400 each)
    factor = Decimal(1)
    presentacion_id = raw.get("presentacion_id")
    if presentacion_id is not None:
        if not isinstance(presentacion_id, int) or isinstance(presentacion_id, bool):
            return None, _error(prefix + "presentacion_id must be a number")
        presentation = access.get_presentation_by_id(presentacion_id)
        if presentation is None or presentation["producto_id"] != producto_id:
            return None, _error(prefix + "presentation does not belong to the product")
        factor = presentation["factor"]

    # HU-12: received quantity must be more than 0. If nothing arrived, the line is not sent
    cantidad = _to_decimal(raw.get("cantidad"))
    if cantidad is None or cantidad <= 0:
        return None, _error(prefix + "cantidad must be greater than 0")

    # HU-12: invoice quantity is optional. Empty means everything arrived
    cantidad_factura = cantidad
    if raw.get("cantidad_factura") is not None:
        cantidad_factura = _to_decimal(raw.get("cantidad_factura"))
        if cantidad_factura is None or cantidad_factura < 0:
            return None, _error(prefix + "cantidad_factura must be 0 or more")

    precio = _to_decimal(raw.get("precio"))
    if precio is None or precio < 0:
        return None, _error(prefix + "precio must be 0 or more")

    cantidad_base = (cantidad * factor).quantize(CANTIDAD_DECIMALES)
    cantidad_factura_base = (cantidad_factura * factor).quantize(CANTIDAD_DECIMALES)

    # HU-07: products sold by unit only take whole numbers
    if product["unidad_base"] == "unidad" and (
        cantidad_base != cantidad_base.to_integral_value()
        or cantidad_factura_base != cantidad_factura_base.to_integral_value()
    ):
        return None, _error(prefix + "products sold by unit only accept whole quantities")

    return {
        "producto_id": producto_id,
        "presentacion_id": presentacion_id,
        "cantidad": cantidad_base,
        "cantidad_factura": cantidad_factura_base,
        # Price per base unit: Q400 the 50 lb box = Q8 per lb
        "precio": (precio / factor).quantize(PRECIO_DECIMALES),
    }, None


def _read_entry(access, body, original=None):
    """Validates the invoice header and its lines (shared by add-entry and correct-entry).

    original: the entry being corrected (HU-14). It may keep its supplier and its products
    even if they were deactivated later, and its own invoice number is not a duplicate.
    Returns (fields, None) when it is fine or (None, error response) when it is not.
    """
    if not isinstance(body, dict) or not body:
        return None, _error("entry data is required")

    proveedor_id = body.get("proveedor_id")
    numero_factura = str(body.get("numero_factura") or "").strip()
    items_raw = body.get("productos")

    if not isinstance(proveedor_id, int) or isinstance(proveedor_id, bool):
        return None, _error("proveedor_id is required")
    if not numero_factura:
        return None, _error("numero_factura is required")
    if len(numero_factura) > 30:
        return None, _error("numero_factura must have at most 30 characters")

    try:
        fecha_factura = date.fromisoformat(str(body.get("fecha_factura") or ""))
    except ValueError:
        return None, _error("fecha_factura must be a date like 2026-11-10")
    if fecha_factura > date.today():
        return None, _error("fecha_factura cannot be in the future")

    if not isinstance(items_raw, list) or len(items_raw) == 0:
        return None, _error("at least one product is required")

    supplier = access.get_supplier_by_id(proveedor_id)
    if supplier is None:
        return None, _error("supplier does not exist", 404)
    # HU-09: a deactivated supplier does not receive new invoices
    keeps_supplier = original is not None and proveedor_id == original["proveedor_id"]
    if not supplier["activo"] and not keeps_supplier:
        return None, _error("supplier is not active")
    exclude_id = original["id"] if original else None
    if access.entry_exists(proveedor_id, numero_factura, exclude_id):
        return None, _error("this invoice from this supplier was already entered", 409)

    keep_product_ids = {p["producto_id"] for p in original["productos"]} if original else set()
    items = []
    for position, raw in enumerate(items_raw, start=1):
        item, error = _validate_item(access, raw, position, keep_product_ids)
        if error:
            return None, error
        items.append(item)

    return {
        "proveedor_id": proveedor_id,
        "numero_factura": numero_factura,
        "fecha_factura": fecha_factura,
        "items": items,
    }, None


def _read_motivo(body):
    """HU-14: why the entry is voided or corrected. Required, at most 200 characters."""
    motivo = str(body.get("motivo") or "").strip() if isinstance(body, dict) else ""
    if not motivo:
        return None, _error("motivo is required")
    if len(motivo) > 200:
        return None, _error("motivo must have at most 200 characters")
    return motivo, None


def _negative_stock(error):
    """HU-18 for HU-14: Angular lists which products would end below 0."""
    return {
        "status": 1,
        "message": "stock would be negative",
        "data": {
            "productos": [
                {**p, "existencia": float(p["existencia"]), "quedaria": float(p["quedaria"])}
                for p in error.productos
            ],
        },
    }, 409


@movements.route('api/v1/add-entry', methods=['POST'])
@requiere_rol()  # HU-11: Kevin and Byron (employees) receive the truck too
def add_entry():
    access = AccessData()
    fields, error = _read_entry(access, request.get_json(silent=True))
    if error:
        return error

    try:
        entry_id = access.add_entry(
            fields["proveedor_id"], fields["numero_factura"], fields["fecha_factura"],
            g.user["users"], fields["items"],
        )
    except pymysql.err.IntegrityError:
        # Two people saving the same invoice at the same time
        return _error("this invoice from this supplier was already entered", 409)

    return {
        "status": 0,
        "message": "SUCCESS: entry created",
        "data": _entry_to_json(access.get_entry_by_id(entry_id)),
    }, 201


@movements.route('api/v1/void-entry/<int:entry_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-14: only the owner voids entries
def void_entry(entry_id):
    motivo, error = _read_motivo(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    entry = access.get_entry_by_id(entry_id)
    if entry is None:
        return _error("entry does not exist", 404)
    if entry["anulada_en"] is not None:
        return _error("entry is already voided")

    try:
        access.void_entry(entry_id, g.user["users"], motivo)
    except EntryAlreadyVoided:
        return _error("entry is already voided")
    except NegativeStock as error:
        # Part of it was already taken out: use correct-entry instead
        return _negative_stock(error)

    return {
        "status": 0,
        "message": "SUCCESS: entry voided",
        "data": _entry_to_json(access.get_entry_by_id(entry_id)),
    }, 200


@movements.route('api/v1/correct-entry/<int:entry_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-14: only the owner corrects entries
def correct_entry(entry_id):
    body = request.get_json(silent=True)
    motivo, error = _read_motivo(body)
    if error:
        return error

    access = AccessData()
    entry = access.get_entry_by_id(entry_id)
    if entry is None:
        return _error("entry does not exist", 404)
    if entry["anulada_en"] is not None:
        return _error("entry is already voided")

    fields, error = _read_entry(access, body, original=entry)
    if error:
        return error

    try:
        new_id = access.correct_entry(
            entry_id, g.user["users"], motivo,
            fields["proveedor_id"], fields["numero_factura"], fields["fecha_factura"],
            fields["items"],
        )
    except EntryAlreadyVoided:
        return _error("entry is already voided")
    except NegativeStock as error:
        return _negative_stock(error)
    except pymysql.err.IntegrityError:
        return _error("this invoice from this supplier was already entered", 409)

    # The corrected entry is a new one; the old one stays voided
    return {
        "status": 0,
        "message": "SUCCESS: entry corrected",
        "data": _entry_to_json(access.get_entry_by_id(new_id)),
    }, 201


@movements.route('api/v1/entries', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_entries():
    # HU-12: ?faltantes=true lists only the entries with shortages
    only_with_shortages = request.args.get("faltantes", "").lower() in ("1", "true")
    entries = AccessData().get_entries(only_with_shortages)
    return {
        "status": 0,
        "message": "SUCCESS: entries",
        "data": [_entry_to_json(entry) for entry in entries],
    }, 200


@movements.route('api/v1/entries/<int:entry_id>', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_entry(entry_id):
    entry = AccessData().get_entry_by_id(entry_id)
    if entry is None:
        return _error("entry does not exist", 404)
    return {
        "status": 0,
        "message": "SUCCESS: entry",
        "data": _entry_to_json(entry),
    }, 200


# ------------------------------------------------------------
# Outputs: stock that leaves without being sold.
# HU-16 merma ('dano') and HU-17 uso interno ('uso'). Sales come from billing.
# ------------------------------------------------------------

OUTPUT_TYPES = ("dano", "uso")


def _output_to_json(output):
    """precio is the last purchase price per base unit; costo is what the output was worth."""
    precio = output["precio"]
    return {
        **output,
        "cantidad": float(output["cantidad"]),
        "precio": float(precio) if precio is not None else None,
        "costo": float((output["cantidad"] * precio).quantize(Decimal("0.01")))
        if precio is not None else None,
        "fecha": output["fecha"].isoformat(),
    }


@movements.route('api/v1/add-output', methods=['POST'])
@requiere_rol()  # HU-16/HU-17: anyone logged in (broken product, or used inside the store)
def add_output():
    body = request.get_json(silent=True)
    if not body:
        return _error("output data is required")

    tipo = body.get("tipo", "dano")
    if tipo not in OUTPUT_TYPES:
        return _error("tipo is not valid")

    producto_id = body.get("producto_id")
    if not isinstance(producto_id, int) or isinstance(producto_id, bool):
        return _error("producto_id is required")

    # HU-16: the reason is required (the DB also checks it)
    motivo = str(body.get("motivo") or "").strip()
    if not motivo:
        return _error("motivo is required")
    if len(motivo) > 200:
        return _error("motivo must have at most 200 characters")

    # Always in the base unit (lb, m or unidad)
    cantidad = _to_decimal(body.get("cantidad"))
    if cantidad is None or cantidad <= 0:
        return _error("cantidad must be greater than 0")
    if cantidad != cantidad.quantize(CANTIDAD_DECIMALES):
        return _error("cantidad must have at most 3 decimals")

    access = AccessData()
    product = access.get_product_by_id(producto_id)
    if product is None:
        return _error("product does not exist", 404)
    if not product["activo"]:
        return _error("product is not active")
    # HU-07: products sold by unit only take whole numbers
    if product["unidad_base"] == "unidad" and cantidad != cantidad.to_integral_value():
        return _error("products sold by unit only accept whole quantities")

    try:
        output_id = access.add_output(tipo, producto_id, cantidad, motivo, g.user["users"])
    except InsufficientStock as error:
        # HU-18: Angular shows "Solo hay 5 en existencia" with this number
        return {
            "status": 1,
            "message": "insufficient stock",
            "data": {"existencia": float(error.existencia)},
        }, 409

    return {
        "status": 0,
        "message": "SUCCESS: output created",
        "data": _output_to_json(access.get_output_by_id(output_id)),
    }, 201


@movements.route('api/v1/outputs', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_outputs():
    # ?tipo=dano or ?tipo=uso lists only that kind; without it, both
    tipo = request.args.get("tipo")
    if tipo is not None and tipo not in OUTPUT_TYPES:
        return _error("tipo is not valid")
    tipos = (tipo,) if tipo else OUTPUT_TYPES
    return {
        "status": 0,
        "message": "SUCCESS: outputs",
        "data": [_output_to_json(o) for o in AccessData().get_outputs(tipos)],
    }, 200


# ------------------------------------------------------------
# HU-20: kárdex of one product (owner only)
# ------------------------------------------------------------

HISTORY_PAGE_SIZES = (25, 50, 100)
TWO_DECIMALS = Decimal("0.01")


def _read_date(name):
    """?desde= / ?hasta= as YYYY-MM-DD. Returns (date or None, error message or None)."""
    value = request.args.get(name, "").strip()
    if not value:
        return None, None
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, f"{name} must be a date YYYY-MM-DD"


def _read_positive_int(name, default):
    value = request.args.get(name, "").strip()
    if not value:
        return default
    return int(value) if value.isdigit() and int(value) > 0 else None


def _history_row_to_json(row):
    precio = row["precio"]
    factor = row["factor"]
    data = {
        "id": row["id"],
        "tipo": row["tipo"],
        "fecha": row["fecha"].isoformat(),
        # Signed: + came in, - went out
        "cantidad": float(row["cambio"]),
        "existencia": float(row["existencia"]),
        "usuario_id": row["usuario_id"],
        "usuario": row["usuario"],
        "motivo": row["motivo"],
        "precio": float(precio) if precio is not None else None,
        # What it was worth: paid for an entrada, purchase price for dano/uso/ajustes
        "costo": float((row["cantidad"] * precio).quantize(TWO_DECIMALS)) if precio is not None else None,
        "proveedor_id": row["proveedor_id"],
        "proveedor": row["proveedor"],
        "entrada_id": row["entrada_id"],
        "numero_factura": row["numero_factura"],
        # HU-34: the physical count that made an ajuste_mas / ajuste_menos
        "conteo_id": row["conteo_id"],
        # Only an entrada can be voided; its 'anulacion' row is the one that takes the stock back
        "anulada": row["tipo"] == "entrada" and bool(row["anulada"]),
        # HU-06: "2 caja" as it came on the invoice
        "presentacion": row["presentacion"],
        "cantidad_presentacion": float(row["cantidad"] / factor) if factor else None,
    }
    return data


@movements.route('api/v1/product-movements/<int:product_id>', methods=['GET'])
@requiere_rol('admin')  # HU-20: Don Rigo checks who did what
def get_product_movements(product_id):
    desde, error = _read_date("desde")
    if error:
        return _error(error)
    hasta, error = _read_date("hasta")
    if error:
        return _error(error)
    if desde and hasta and desde > hasta:
        return _error("desde must not be after hasta")

    page = _read_positive_int("page", 1)
    if page is None:
        return _error("page must be a whole number greater than 0")
    per_page = _read_positive_int("per_page", HISTORY_PAGE_SIZES[0])
    if per_page not in HISTORY_PAGE_SIZES:
        return _error("per_page must be 25, 50 or 100")

    access = AccessData()
    history = access.get_product_history(
        product_id,
        # desde from 00:00; hasta includes that whole day
        desde=datetime.combine(desde, time.min) if desde else None,
        hasta=datetime.combine(hasta + timedelta(days=1), time.min) if hasta else None,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    if history is None:
        return _error("product does not exist", 404)

    total = history["total"]
    pages = max(1, -(-total // per_page))
    product = history["producto"]
    summary = history["resumen"]
    return {
        "status": 0,
        "message": "SUCCESS: product movements",
        "data": {
            "producto": {
                **product,
                "activo": bool(product["activo"]),
                "existencia": float(product["existencia"]),
            },
            "resumen": {key: float(value) for key, value in summary.items()},
            "movimientos": [_history_row_to_json(row) for row in history["movimientos"]],
            "total": total,
            "page": page,
            "pages": pages,
            "per_page": per_page,
        },
    }, 200
