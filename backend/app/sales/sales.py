"""HU-15: "Sacar lo que se vendió". The counter registers a sale of one or more products
and the stock goes down. Built here because the billing module will not be made (2026-11-19).

Prices come from products.precio (HU-02: only the owner sets them; the cashier never types one).
The ticket is a sample "factura" in Guatemalan style, with no fiscal value (it is not a FEL DTE).
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import re

from flask import Blueprint, g, request

from app.access_data import AccessData, NegativeStock
from app.catalog.catalog import _to_decimal
from app.security import requiere_rol

sales = Blueprint('sales', __name__)

CANTIDAD_DECIMALES = Decimal('0.001')  # movements.cantidad decimal(10,3)
TWO_DECIMALS = Decimal('0.01')
MAX_ITEMS = 50
# Guatemala: prices include IVA (12 %); the ticket shows how much of the total it is
IVA = Decimal('0.12')


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def normalize_nit(raw):
    """Guatemalan NIT: digits plus a check digit (0-9 or K), checked with SAT's modulo 11.
    "CF" (consumidor final) is also valid. Returns the NIT as "1234567-9" / "CF", or None if invalid.

    Check digit: multiply the digits by 2, 3, 4... from the right, add them up,
    (11 - sum % 11) % 11, and 10 is written K.
    """
    text = re.sub(r"[\s-]", "", str(raw or "")).upper()
    if text in ("", "CF", "C/F"):
        return "CF"
    if not re.fullmatch(r"\d{1,12}[\dK]", text):
        return None
    body, check = text[:-1], text[-1]
    total = sum(int(digit) * weight for digit, weight in zip(reversed(body), range(2, 100)))
    expected = (11 - total % 11) % 11
    if check != ("K" if expected == 10 else str(expected)):
        return None
    return f"{body}-{check}"


def _read_items(access, raw_items):
    """Returns ([(producto_id, Decimal cantidad)], products by id, None) or (None, None, error)."""
    if not isinstance(raw_items, list) or not raw_items:
        return None, None, _error("at least one product is required")
    if len(raw_items) > MAX_ITEMS:
        return None, None, _error(f"a sale can have at most {MAX_ITEMS} products")

    items = []
    seen = set()
    for raw in raw_items:
        producto_id = raw.get("producto_id") if isinstance(raw, dict) else None
        if not isinstance(producto_id, int) or isinstance(producto_id, bool):
            return None, None, _error("producto_id is required")
        if producto_id in seen:
            return None, None, _error("a product appears twice")
        seen.add(producto_id)
        # Always in the base unit (lb, m, gal or unidad), like the outputs
        cantidad = _to_decimal(raw.get("cantidad"))
        if cantidad is None or cantidad <= 0:
            return None, None, _error("cantidad must be greater than 0")
        if cantidad != cantidad.quantize(CANTIDAD_DECIMALES):
            return None, None, _error("cantidad must have at most 3 decimals")
        items.append((producto_id, cantidad))

    products = {}
    for producto_id, cantidad in items:
        product = access.get_product_by_id(producto_id)
        if product is None:
            return None, None, _error("product does not exist", 404)
        # HU-04: an inactive product is not sold anymore
        if not product["activo"]:
            return None, None, _error(f"product {product['codigo']} is not active")
        # HU-07: products sold by unit only take whole numbers
        if product["unidad_base"] == "unidad" and cantidad != cantidad.to_integral_value():
            return None, None, _error("products sold by unit only accept whole quantities")
        products[producto_id] = product
    return items, products, None


def _sale_to_json(sale):
    total = sale["total"]
    data = {
        "id": sale["id"],
        "fecha": sale["fecha"].isoformat(),
        "nit_cliente": sale["nit_cliente"],
        "nombre_cliente": sale["nombre_cliente"],
        "usuario_id": sale["usuario_id"],
        "usuario": sale["usuario"],
        "productos": sale["productos"],
        "total": float(total),
        # The IVA already inside the total: total - total / 1.12
        "iva": float((total - total / (1 + IVA)).quantize(TWO_DECIMALS)),
    }
    if "items" in sale:
        data["items"] = [{
            "producto_id": item["producto_id"],
            "codigo": item["codigo"],
            "nombre": item["nombre"],
            "unidad_base": item["unidad_base"],
            "cantidad": float(item["cantidad"]),
            "precio": float(item["precio"]),
            "subtotal": float((item["cantidad"] * item["precio"]).quantize(TWO_DECIMALS)),
        } for item in sale["items"]]
    return data


@sales.route('api/v1/add-sale', methods=['POST'])
@requiere_rol()  # HU-15: Kevin and Byron sell at the counter
def add_sale():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error("sale data is required")

    nit = normalize_nit(body.get("nit_cliente"))
    if nit is None:
        return _error("nit_cliente is not a valid NIT")
    nombre = re.sub(r"\s+", " ", str(body.get("nombre_cliente") or "")).strip()
    if nit == "CF" and not nombre:
        nombre = "Consumidor Final"
    if not nombre:
        return _error("nombre_cliente is required when there is a NIT")
    if len(nombre) > 100:
        return _error("nombre_cliente must have at most 100 characters")

    access = AccessData()
    items, products, error = _read_items(access, body.get("items"))
    if error:
        return error

    try:
        sale_id = access.add_sale(g.user["users"], nit, nombre, items)
    except NegativeStock as problem:
        # HU-18: nothing was saved; Angular says which products do not reach
        return {
            "status": 1,
            "message": "insufficient stock",
            "data": {"productos": [{
                "producto_id": p["producto_id"],
                "codigo": p["codigo"],
                "nombre": p["nombre"],
                "unidad_base": p["unidad_base"],
                "existencia": float(p["existencia"]),
            } for p in problem.productos]},
        }, 409

    return {
        "status": 0,
        "message": "SUCCESS: sale saved",
        "data": _sale_to_json(access.get_sale(sale_id)),
    }, 201


@sales.route('api/v1/sales', methods=['GET'])
@requiere_rol()  # the counter sees the sales of the day (to reprint a ticket)
def get_sales():
    """?fecha=YYYY-MM-DD (default today): the sales of that day, newest first."""
    raw = request.args.get("fecha")
    try:
        day = date.fromisoformat(raw) if raw else date.today()
    except ValueError:
        return _error("fecha must be YYYY-MM-DD")
    desde = datetime.combine(day, time.min)
    rows = AccessData().get_sales(desde, desde + timedelta(days=1))
    ventas = [_sale_to_json(row) for row in rows]
    return {
        "status": 0,
        "message": "SUCCESS: sales",
        "data": {
            "fecha": day.isoformat(),
            "ventas": ventas,
            "total": round(sum(v["total"] for v in ventas), 2),
        },
    }, 200


@sales.route('api/v1/sales/<int:sale_id>', methods=['GET'])
@requiere_rol()
def get_sale(sale_id):
    sale = AccessData().get_sale(sale_id)
    if sale is None:
        return _error("sale does not exist", 404)
    return {"status": 0, "message": "SUCCESS: sale", "data": _sale_to_json(sale)}, 200
