"""HU-15: "Sacar lo que se vendió". The counter registers a sale of one or more products
and the stock goes down. Built here because the billing module will not be made (2026-11-19).

Prices come from products.precio (HU-02: only the owner sets them; the cashier never types one).
The ticket is a sample "factura" in Guatemalan style, with no fiscal value (it is not a FEL DTE).
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import re

from flask import Blueprint, g, request

from app.access_data import AccessData, NegativeStock, ReturnTooMuch
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
        # HU-13: money already given back for returns of this sale
        "devuelto": float(sale["devuelto"]),
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
            # HU-13: already returned and what can still be returned
            "devuelto": float(item["devuelto"]),
            "por_devolver": float(item["cantidad"] - item["devuelto"]),
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


# HU-24: longest range whose days are all filled in (with 0) for the chart
MAX_CHART_DAYS = 366


def _read_date(name):
    """?desde= / ?hasta= as YYYY-MM-DD. Returns (date or None, error message or None)."""
    value = request.args.get(name, "").strip()
    if not value:
        return None, None
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, f"{name} must be a date YYYY-MM-DD"


def _sales_per_day(access, desde, hasta):
    """[{fecha, ventas, total}] oldest first. With both dates (and a range the chart can show)
    every day is there, 0 when nothing was sold; otherwise only the days with sales."""
    start = datetime.combine(desde, time.min) if desde else None
    end = datetime.combine(hasta + timedelta(days=1), time.min) if hasta else None
    days = {
        row["dia"]: {"ventas": row["ventas"], "total": float(row["total"])}
        for row in access.get_sales_by_day(start, end)
    }
    if desde and hasta and (hasta - desde).days < MAX_CHART_DAYS:
        dates = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]
    else:
        dates = sorted(days)
    return [{"fecha": d.isoformat(), **days.get(d, {"ventas": 0, "total": 0.0})} for d in dates]


def _top_sale_to_json(row):
    existencia = float(row["existencia"])
    minimo = float(row["stock_minimo"]) if row["stock_minimo"] is not None else None
    return {
        "id": row["id"],
        "codigo": row["codigo"],
        "nombre": row["nombre"],
        "categoria": row["categoria"],
        "unidad_base": row["unidad_base"],
        "activo": bool(row["activo"]),
        "cantidad": float(row["cantidad"]),  # sold minus returned (HU-13)
        "devuelto": float(row["devuelto"]),
        "ventas": row["ventas"],
        "dinero": float(row["dinero"]),
        "existencia": existencia,
        "stock_minimo": minimo,
        # "para nunca quedarme sin eso": same rule as HU-22
        "bajo_minimo": minimo is not None and existencia <= minimo,
    }


@sales.route('api/v1/top-sales', methods=['GET'])
@requiere_rol('admin')  # HU-24: reports are the owner's (HU-29)
def get_top_sales():
    """HU-24 "Ver lo que más se vende": ?desde=&hasta= (YYYY-MM-DD, hasta includes that day;
    both optional). Products sold in the range, most sold quantity first, plus sales per day."""
    desde, error = _read_date("desde")
    if error:
        return _error(error)
    hasta, error = _read_date("hasta")
    if error:
        return _error(error)
    if desde and hasta and desde > hasta:
        return _error("desde must not be after hasta")

    start = datetime.combine(desde, time.min) if desde else None
    end = datetime.combine(hasta + timedelta(days=1), time.min) if hasta else None
    access = AccessData()
    productos = [_top_sale_to_json(row) for row in access.get_top_sales(start, end)]
    por_dia = _sales_per_day(access, desde, hasta)
    vendido = round(sum(d["total"] for d in por_dia), 2)
    devuelto = float(access.get_returned_money(start, end))

    return {
        "status": 0,
        "message": "SUCCESS: top sales",
        "data": {
            "desde": desde.isoformat() if desde else None,
            "hasta": hasta.isoformat() if hasta else None,
            "resumen": {
                "productos": len(productos),
                "ventas": sum(d["ventas"] for d in por_dia),
                # Tickets minus the money given back for returns in the range (HU-13)
                "dinero": round(vendido - devuelto, 2),
                "vendido": vendido,
                "devuelto": devuelto,
            },
            "productos": productos,
            "por_dia": por_dia,
        },
    }, 200


DASHBOARD_DAYS = (7, 30)


@sales.route('api/v1/dashboard-summary', methods=['GET'])
@requiere_rol()  # decided 2026-11-20: employees also see the dashboard's numbers and lists
def get_dashboard_summary():
    """?dias=7|30 (default 30). Only what the dashboard shows: the money in the store
    (HU-26 total: existencia × precio_compra, products without price left out) and the
    sales of the last N days for the chart (HU-24), the 4 most sold products of those days,
    the 4 latest sales and the 4 latest movements. The full reports stay owner only."""
    dias = request.args.get("dias", "30")
    if not dias.isdigit() or int(dias) not in DASHBOARD_DAYS:
        return _error("dias must be 7 or 30")
    hasta = date.today()
    desde = hasta - timedelta(days=int(dias) - 1)

    access = AccessData()
    stock = access.get_stock_with_cost()
    dinero = sum(
        (row["existencia"] * row["precio_compra"]).quantize(TWO_DECIMALS)
        for row in stock
        if row["precio_compra"] is not None
    )
    conteo = access.get_open_count()
    # "Pendientes" box: what someone has to sort out. Out of stock comes from low-stock (HU-22)
    pendientes = {
        # HU-12: valid invoices where something arrived different from the paper
        "facturas_faltantes": len(access.get_entries(only_with_shortages=True)),
        # HU-32: the open count, if any
        "conteo_abierto": {"id": conteo["id"], "creado_en": conteo["creado_en"].isoformat()} if conteo else None,
        # HU-26: products with stock but no purchase price (left out of the money). Owner only
        "sin_precio": (
            sum(1 for row in stock if row["precio_compra"] is None) if g.user["rol"] == "admin" else None
        ),
    }
    return {
        "status": 0,
        "message": "SUCCESS: dashboard summary",
        "data": {
            "dinero_bodega": float(dinero),
            "desde": desde.isoformat(),
            "hasta": hasta.isoformat(),
            "por_dia": _sales_per_day(access, desde, hasta),
            "pendientes": pendientes,
            # The dashboard's three lists (decided 2026-11-20: every user, no purchase prices)
            "mas_vendidos": _dashboard_top(access, desde, hasta),
            "ultimas_ventas": [
                _sale_to_json(row)
                for row in access.get_sales(datetime(2000, 1, 1), datetime.combine(hasta + timedelta(days=1), time.min), DASHBOARD_ROWS)
            ],
            "ultimos_movimientos": [
                _activity_to_json(row) for row in access.get_movements(limit=DASHBOARD_ROWS)["movimientos"]
            ],
        },
    }, 200


DASHBOARD_ROWS = 4


def _dashboard_top(access, desde, hasta):
    """HU-24 in short: the 4 most sold products of the chart's days (returns subtracted)."""
    rows = access.get_top_sales(datetime.combine(desde, time.min), datetime.combine(hasta + timedelta(days=1), time.min))
    return [{
        "id": row["id"],
        "codigo": row["codigo"],
        "nombre": row["nombre"],
        "categoria": row["categoria"],
        "unidad_base": row["unidad_base"],
        "cantidad": float(row["cantidad"]),
        "ventas": row["ventas"],
        "dinero": float(row["dinero"]),
    } for row in rows[:DASHBOARD_ROWS]]


def _activity_to_json(row):
    """A movement for the dashboard's "Actividad reciente": what, how much, who and when.
    No price: the purchase price is the owner's (HU-29)."""
    return {
        "id": row["id"],
        "tipo": row["tipo"],
        "cantidad": float(row["cantidad"]),
        "cambio": float(row["cambio"]),  # signed: + adds stock, - takes it out
        "fecha": row["fecha"].isoformat(),
        "producto_id": row["producto_id"],
        "codigo": row["codigo"],
        "producto": row["producto"],
        "unidad_base": row["unidad_base"],
        "usuario": row["usuario"],
        "venta_id": row["venta_id"],
        "numero_factura": row["numero_factura"],
    }


STALE_DAYS = (30, 60, 90)


@sales.route('api/v1/stale-products', methods=['GET'])
@requiere_rol('admin')  # HU-25: reports are the owner's (HU-29)
def get_stale_products():
    """HU-25 "Ver lo que no se mueve": ?dias=30|60|90 (default 90). Products with stock and no
    sale in that time, with the money they hold at purchase price (same as HU-26).
    Most money first (decided 2026-11-20, option A); without purchase price at the end."""
    dias = request.args.get("dias", "90")
    if not dias.isdigit() or int(dias) not in STALE_DAYS:
        return _error("dias must be 30, 60 or 90")
    dias = int(dias)
    today = date.today()
    desde = datetime.combine(today - timedelta(days=dias), time.min)

    access = AccessData()
    productos = []
    for row in access.get_stale_products(desde):
        existencia = row["existencia"]
        precio = row["precio_compra"]
        ultima = row["ultima_venta"]
        productos.append({
            "id": row["id"],
            "codigo": row["codigo"],
            "nombre": row["nombre"],
            "categoria": row["categoria"],
            "unidad_base": row["unidad_base"],
            "activo": bool(row["activo"]),
            "existencia": float(existencia),
            "precio_compra": float(precio) if precio is not None else None,
            "dinero": float((existencia * precio).quantize(TWO_DECIMALS)) if precio is not None else None,
            "ultima_venta": ultima.date().isoformat() if ultima else None,
            # Days without selling; if it never sold, days since it arrived
            "dias_sin_vender": (today - (ultima or row["primer_movimiento"]).date()).days,
            "nunca_vendido": ultima is None,
        })
    productos.sort(key=lambda p: (p["dinero"] is None, -(p["dinero"] or 0), -p["dias_sin_vender"]))

    dinero = sum(p["dinero"] for p in productos if p["dinero"] is not None)
    bodega = sum(
        (row["existencia"] * row["precio_compra"]).quantize(TWO_DECIMALS)
        for row in access.get_stock_with_cost()
        if row["precio_compra"] is not None
    )
    return {
        "status": 0,
        "message": "SUCCESS: stale products",
        "data": {
            "dias": dias,
            "desde": desde.date().isoformat(),
            "resumen": {
                "productos": len(productos),
                "dinero": round(dinero, 2),
                "valor_bodega": float(bodega),
                "porcentaje": round(dinero / float(bodega) * 100, 1) if bodega else 0,
                "nunca_vendidos": sum(1 for p in productos if p["nunca_vendido"]),
                "sin_precio": sum(1 for p in productos if p["dinero"] is None),
            },
            "productos": productos,
        },
    }, 200


RETURN_MOTIVO_MAX = 150  # leaves room for "Devolución dañada (venta #N): " in the merma motivo


@sales.route('api/v1/add-return', methods=['POST'])
@requiere_rol()  # HU-13: Kevin and Byron receive the returns at the counter
def add_return():
    """HU-13 "Recibir una devolución": {venta_id, motivo, items: [{producto_id, cantidad, danado}]}.
    Only products of that sale, never more than what is left to return (decided 2026-11-20:
    the ticket is required, no time limit). A good one goes back to the shelf; a damaged one
    is registered and also written off as a merma, so it does not add."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _error("return data is required")
    venta_id = body.get("venta_id")
    if not isinstance(venta_id, int) or isinstance(venta_id, bool):
        return _error("venta_id is required")
    motivo = re.sub(r"\s+", " ", str(body.get("motivo") or "")).strip() or None
    if motivo and len(motivo) > RETURN_MOTIVO_MAX:
        return _error(f"motivo must have at most {RETURN_MOTIVO_MAX} characters")

    access = AccessData()
    sale = access.get_sale(venta_id)
    if sale is None:
        return _error("sale does not exist", 404)
    sold = {item["producto_id"]: item for item in sale["items"]}

    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return _error("at least one product is required")
    items, seen = [], set()
    for raw in raw_items:
        producto_id = raw.get("producto_id") if isinstance(raw, dict) else None
        if producto_id not in sold:
            return _error("every product must belong to the sale")
        if producto_id in seen:
            return _error("a product can only appear once")
        seen.add(producto_id)
        danado = raw.get("danado", False)
        if not isinstance(danado, bool):
            return _error("danado must be true or false")
        cantidad = _to_decimal(raw.get("cantidad"))
        if cantidad is None or cantidad <= 0:
            return _error("cantidad must be greater than 0")
        if cantidad != cantidad.quantize(CANTIDAD_DECIMALES):
            return _error("cantidad can have at most 3 decimals")
        # HU-07: products sold by unit come back whole
        if sold[producto_id]["unidad_base"] == "unidad" and cantidad != cantidad.to_integral_value():
            return _error("cantidad must be a whole number for products sold by unit")
        items.append((producto_id, cantidad, danado))

    try:
        devolver = access.add_return(venta_id, g.user["users"], items, motivo)
    except ReturnTooMuch as problem:
        # Someone returned part of it meanwhile (or the client asked for more than bought)
        return {
            "status": 1,
            "message": "return exceeds what was sold",
            "data": {"productos": [{
                "producto_id": p["producto_id"],
                "nombre": sold[p["producto_id"]]["nombre"],
                "unidad_base": sold[p["producto_id"]]["unidad_base"],
                "vendido": float(p["vendido"]),
                "devuelto": float(p["devuelto"]),
                "por_devolver": float(p["vendido"] - p["devuelto"]),
            } for p in problem.productos]},
        }, 409

    return {
        "status": 0,
        "message": "SUCCESS: return saved",
        "data": {
            "venta_id": venta_id,
            "devolver": float(devolver),  # money to give back to the customer
            "venta": _sale_to_json(access.get_sale(venta_id)),
        },
    }, 201


@sales.route('api/v1/returns', methods=['GET'])
@requiere_rol()
def get_returns():
    """HU-13: the latest 50 returned products, newest first."""
    return {
        "status": 0,
        "message": "SUCCESS: returns",
        "data": [{
            "id": row["id"],
            "fecha": row["fecha"].isoformat(),
            "venta_id": row["venta_id"],
            "producto_id": row["producto_id"],
            "codigo": row["codigo"],
            "nombre": row["nombre"],
            "unidad_base": row["unidad_base"],
            "cantidad": float(row["cantidad"]),
            "precio": float(row["precio"]),
            "monto": float((row["cantidad"] * row["precio"]).quantize(TWO_DECIMALS)),
            "danado": bool(row["danado"]),
            "motivo": row["motivo"],
            "usuario": row["usuario"],
        } for row in AccessData().get_returns()],
    }, 200
