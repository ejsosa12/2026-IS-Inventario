from datetime import date
from decimal import Decimal

from flask import Blueprint, g, request
import pymysql

from app.access_data import AccessData
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


def _validate_item(access, raw, position):
    """Checks one invoice line and converts it to the base unit.

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
    if not product["activo"]:
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


@movements.route('api/v1/add-entry', methods=['POST'])
@requiere_rol()  # HU-11: Kevin and Byron (employees) receive the truck too
def add_entry():
    body = request.get_json(silent=True)

    if not body:
        return _error("entry data is required")

    proveedor_id = body.get("proveedor_id")
    numero_factura = str(body.get("numero_factura") or "").strip()
    items_raw = body.get("productos")

    if not isinstance(proveedor_id, int) or isinstance(proveedor_id, bool):
        return _error("proveedor_id is required")
    if not numero_factura:
        return _error("numero_factura is required")
    if len(numero_factura) > 30:
        return _error("numero_factura must have at most 30 characters")

    try:
        fecha_factura = date.fromisoformat(str(body.get("fecha_factura") or ""))
    except ValueError:
        return _error("fecha_factura must be a date like 2026-11-10")
    if fecha_factura > date.today():
        return _error("fecha_factura cannot be in the future")

    if not isinstance(items_raw, list) or len(items_raw) == 0:
        return _error("at least one product is required")

    access = AccessData()
    if access.get_supplier_by_id(proveedor_id) is None:
        return _error("supplier does not exist", 404)
    if access.entry_exists(proveedor_id, numero_factura):
        return _error("this invoice from this supplier was already entered", 409)

    items = []
    for position, raw in enumerate(items_raw, start=1):
        item, error = _validate_item(access, raw, position)
        if error:
            return error
        items.append(item)

    try:
        entry_id = access.add_entry(
            proveedor_id, numero_factura, fecha_factura, g.user["users"], items
        )
    except pymysql.err.IntegrityError:
        # Two people saving the same invoice at the same time
        return _error("this invoice from this supplier was already entered", 409)

    return {
        "status": 0,
        "message": "SUCCESS: entry created",
        "data": _entry_to_json(access.get_entry_by_id(entry_id)),
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
