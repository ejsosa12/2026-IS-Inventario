from decimal import Decimal, InvalidOperation

from flask import Blueprint, g, request

from app.access_data import AccessData, CountAlreadyOpen, CountChanged, CountNotOpen
from app.security import requiere_rol

# HU-32/33/34: physical count. Anyone starts one and prints the sheets; only the owner
# sees the system's stock and money and applies the adjustments.
counts = Blueprint('counts', __name__)


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def _count_to_json(count, items=None):
    data = {
        **count,
        "creado_en": count["creado_en"].isoformat(),
        "cerrado_en": count["cerrado_en"].isoformat() if count["cerrado_en"] else None,
    }
    if items is not None:
        data["items"] = [_item_to_json(item) for item in items]
        # Names of the categories in the count, in the order of the sheets
        data["categorias"] = list(dict.fromkeys(item["categoria"] for item in items))
    return data


# count_items.contado is decimal(10,3)
CONTADO_MAX = Decimal("9999999.999")


def _read_contado(value, unidad_base):
    """HU-33: what was written on the sheet. Returns (Decimal or None, error or None).

    None means "not counted yet" (the box was left blank). HU-07: whole for 'unidad'.
    """
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None, "contado must be a number"
    try:
        contado = Decimal(str(value).strip())
    except InvalidOperation:
        return None, "contado must be a number"
    if not contado.is_finite() or contado < 0:
        return None, "contado must be 0 or more"
    if contado > CONTADO_MAX:
        return None, "contado is too big"
    if contado != contado.quantize(Decimal("0.001")):
        return None, "contado allows at most 3 decimals"
    if unidad_base == "unidad" and contado != contado.to_integral_value():
        return None, "contado must be a whole number for products sold by unit"
    return contado, None


def _item_to_json(item):
    return {
        **item,
        "activo": bool(item["activo"]),
        "contado": float(item["contado"]) if item["contado"] is not None else None,
        "contado_en": item["contado_en"].isoformat() if item["contado_en"] else None,
    }


@counts.route('api/v1/counts/current', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_current_count():
    """The open count, or data: null when there is none."""
    count = AccessData().get_open_count()
    return {
        "status": 0,
        "message": "SUCCESS: current count",
        "data": _count_to_json(count) if count else None,
    }, 200


@counts.route('api/v1/counts/<int:count_id>', methods=['GET'])
@requiere_rol()  # any logged-in user. HU-32: no stock here, so the count is honest
def get_count(count_id):
    access = AccessData()
    count = access.get_count_by_id(count_id)
    if count is None:
        return _error("count does not exist", 404)
    return {
        "status": 0,
        "message": "SUCCESS: count",
        "data": _count_to_json(count, access.get_count_items(count_id)),
    }, 200


@counts.route('api/v1/add-count', methods=['POST'])
@requiere_rol()  # HU-32: anyone can start a count
def add_count():
    body = request.get_json(silent=True) or {}
    categoria_ids = body.get("categoria_ids")
    if (not isinstance(categoria_ids, list) or not categoria_ids
            or any(isinstance(c, bool) or not isinstance(c, int) for c in categoria_ids)):
        return _error("categoria_ids must be a list with at least one category id")
    categoria_ids = sorted(set(categoria_ids))

    access = AccessData()
    for categoria_id in categoria_ids:
        if access.get_category_by_id(categoria_id) is None:
            return _error("categoria_id does not exist", 404)
    if access.count_products_in_categories(categoria_ids) == 0:
        return _error("those categories have no products to count")

    try:
        count_id = access.add_count(categoria_ids, g.user["users"])
    except CountAlreadyOpen:
        return _error("there is already an open count", 409)

    return {
        "status": 0,
        "message": "SUCCESS: count created",
        "data": _count_to_json(access.get_count_by_id(count_id), access.get_count_items(count_id)),
    }, 201


@counts.route('api/v1/cancel-count/<int:count_id>', methods=['PUT'])
@requiere_rol('admin')  # only the owner cancels a count started by mistake
def cancel_count(count_id):
    access = AccessData()
    count = access.get_count_by_id(count_id)
    if count is None:
        return _error("count does not exist", 404)
    if not access.cancel_count(count_id, g.user["users"]):
        return _error("count is not open")
    return {
        "status": 0,
        "message": "SUCCESS: count cancelled",
        "data": _count_to_json(access.get_count_by_id(count_id)),
    }, 200


@counts.route('api/v1/count-items/<int:count_id>', methods=['PUT'])
@requiere_rol()  # HU-33: anyone types in what was counted
def save_count_items(count_id):
    """Saves one sheet: {items: [{producto_id, contado}]}. contado null = not counted yet."""
    access = AccessData()
    count = access.get_count_by_id(count_id)
    if count is None:
        return _error("count does not exist", 404)
    if count["estado"] != "abierto":
        return _error("count is not open")

    body = request.get_json(silent=True) or {}
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return _error("items must be a list with at least one product")

    # The products of this count, to check each line and its unit
    in_count = {item["producto_id"]: item for item in access.get_count_items(count_id)}
    values = {}
    for line in items:
        producto_id = line.get("producto_id") if isinstance(line, dict) else None
        if isinstance(producto_id, bool) or not isinstance(producto_id, int):
            return _error("each item needs a producto_id")
        if producto_id not in in_count:
            return _error(f"product {producto_id} is not in this count")
        if producto_id in values:
            return _error(f"product {producto_id} is repeated")
        contado, problem = _read_contado(line.get("contado"), in_count[producto_id]["unidad_base"])
        if problem:
            return _error(f"{in_count[producto_id]['codigo']}: {problem}")
        values[producto_id] = contado

    try:
        changed = access.save_count_items(count_id, values, g.user["users"])
    except CountNotOpen:
        return _error("count is not open")

    return {
        "status": 0,
        "message": f"SUCCESS: {changed} products saved",
        "data": _count_to_json(access.get_count_by_id(count_id), access.get_count_items(count_id)),
    }, 200


def _adjustment_to_json(movement):
    """HU-34: what the count applied to a product. cantidad is signed (+ sobraba, − faltaba)."""
    if movement is None:
        return None
    cantidad = movement["cantidad"] if movement["tipo"] == "ajuste_mas" else -movement["cantidad"]
    precio = movement["precio"]
    return {
        "tipo": movement["tipo"],
        "cantidad": float(cantidad),
        "motivo": movement["motivo"],
        "dinero": round(float(cantidad * precio), 2) if precio is not None else None,
    }


def _compare_to_json(item, adjustment=None):
    """HU-33: sistema, contado, diferencia (contado − sistema) and dinero (diferencia × costo).
    HU-34: ajuste = what was applied (None if that product was not adjusted)."""
    existencia = item["existencia"]
    contado = item["contado"]
    precio = item["precio_compra"]
    diferencia = contado - existencia if contado is not None else None
    dinero = diferencia * precio if diferencia is not None and precio is not None else None
    return {
        **_item_to_json(item),
        "existencia": float(existencia),
        "precio_compra": float(precio) if precio is not None else None,
        "diferencia": float(diferencia) if diferencia is not None else None,
        "dinero": round(float(dinero), 2) if dinero is not None else None,
        "ajuste": _adjustment_to_json(adjustment),
    }


@counts.route('api/v1/counts/<int:count_id>/compare', methods=['GET'])
@requiere_rol('admin')  # HU-33: only the owner sees the system's stock and the money
def compare_count(count_id):
    access = AccessData()
    count = access.get_count_by_id(count_id)
    if count is None:
        return _error("count does not exist", 404)

    adjustments = access.get_count_adjustments(count_id)
    items = [_compare_to_json(item, adjustments.get(item["producto_id"]))
             for item in access.get_count_compare(count_id)]
    counted = [i for i in items if i["diferencia"] is not None]
    different = [i for i in counted if i["diferencia"] != 0]
    faltante = sum(-i["dinero"] for i in different if i["dinero"] is not None and i["dinero"] < 0)
    sobrante = sum(i["dinero"] for i in different if i["dinero"] is not None and i["dinero"] > 0)
    data = _count_to_json(count)
    data["items"] = items
    data["categorias"] = list(dict.fromkeys(i["categoria"] for i in items))
    data["resumen"] = {
        "productos": len(items),
        "contados": len(counted),
        "pendientes": len(items) - len(counted),
        "con_diferencia": len(different),
        "faltante": round(faltante, 2),
        "sobrante": round(sobrante, 2),
        "neto": round(sobrante - faltante, 2),
        # With a difference but no purchase price: their money is unknown
        "sin_precio": sum(1 for i in different if i["dinero"] is None),
    }
    return {"status": 0, "message": "SUCCESS: count compared", "data": data}, 200


@counts.route('api/v1/counts', methods=['GET'])
@requiere_rol('admin')  # HU-34: the owner reviews past counts
def get_counts():
    return {
        "status": 0,
        "message": "SUCCESS: counts",
        "data": [_count_to_json(count) for count in AccessData().get_counts()],
    }, 200


# HU-34: why the shelf and the system did not match (decided 2026-11-16)
ADJUSTMENT_REASONS = ("Pérdida", "Error de registro", "Producto dañado", "Producto encontrado", "Otro")
DETALLE_MAX = 150


def _read_adjustment(line, in_count):
    """One approved adjustment. Returns (producto_id, {motivo, diferencia}, error)."""
    producto_id = line.get("producto_id") if isinstance(line, dict) else None
    if isinstance(producto_id, bool) or not isinstance(producto_id, int):
        return None, None, "each adjustment needs a producto_id"
    item = in_count.get(producto_id)
    if item is None:
        return None, None, f"product {producto_id} is not in this count"
    if item["contado"] is None:
        return None, None, f"{item['codigo']}: was not counted"

    motivo = line.get("motivo")
    if motivo not in ADJUSTMENT_REASONS:
        return None, None, f"{item['codigo']}: motivo must be one of {', '.join(ADJUSTMENT_REASONS)}"
    if motivo == "Otro":
        detalle = line.get("detalle")
        detalle = " ".join(detalle.split()) if isinstance(detalle, str) else ""
        if not detalle:
            return None, None, f"{item['codigo']}: motivo 'Otro' needs a detalle"
        if len(detalle) > DETALLE_MAX:
            return None, None, f"{item['codigo']}: detalle allows at most {DETALLE_MAX} characters"
        motivo = f"Otro: {detalle}"

    value = line.get("diferencia")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, None, f"{item['codigo']}: diferencia must be a number"
    diferencia = Decimal(str(value))
    if not diferencia.is_finite() or diferencia == 0:
        return None, None, f"{item['codigo']}: diferencia must not be 0"
    return producto_id, {"motivo": motivo, "diferencia": diferencia}, None


@counts.route('api/v1/apply-count/<int:count_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-34: only the owner authorizes the adjustments
def apply_count(count_id):
    """{ajustes: [{producto_id, motivo, detalle, diferencia}]}. Closes the count as 'aplicado'.

    Only the listed products are adjusted (partial apply); an empty list closes the count
    without adjustments (everything matched). diferencia is what the owner saw: if it is not
    the one there is now, nothing is applied and the answer is 409 with data.productos.
    """
    access = AccessData()
    count = access.get_count_by_id(count_id)
    if count is None:
        return _error("count does not exist", 404)
    if count["estado"] != "abierto":
        return _error("count is not open")

    body = request.get_json(silent=True) or {}
    lines = body.get("ajustes")
    if not isinstance(lines, list):
        return _error("ajustes must be a list")

    in_count = {item["producto_id"]: item for item in access.get_count_items(count_id)}
    ajustes = {}
    for line in lines:
        producto_id, ajuste, problem = _read_adjustment(line, in_count)
        if problem:
            return _error(problem)
        if producto_id in ajustes:
            return _error(f"product {producto_id} is repeated")
        ajustes[producto_id] = ajuste

    try:
        applied = access.apply_count(count_id, ajustes, g.user["users"])
    except CountNotOpen:
        return _error("count is not open")
    except CountChanged as error:
        return {
            "status": 1,
            "message": "the differences changed, review them again",
            "data": {"productos": [{
                **p,
                "existencia": float(p["existencia"]),
                "contado": float(p["contado"]) if p["contado"] is not None else None,
                "diferencia": float(p["diferencia"]) if p["diferencia"] is not None else None,
                "aprobada": float(p["aprobada"]),
            } for p in error.productos]},
        }, 409

    return {
        "status": 0,
        "message": f"SUCCESS: count applied with {applied} adjustments",
        "data": _count_to_json(access.get_count_by_id(count_id)),
    }, 200
