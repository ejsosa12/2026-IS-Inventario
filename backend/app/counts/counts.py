from flask import Blueprint, g, request

from app.access_data import AccessData, CountAlreadyOpen
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
