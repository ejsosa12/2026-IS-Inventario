from flask import Blueprint, request
import pymysql

from app.access_data import AccessData
from app.security import requiere_rol

suppliers = Blueprint('suppliers', __name__)


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def _supplier_to_json(supplier):
    """activo comes from the DB as 0/1; Angular expects true/false."""
    return {**supplier, "activo": bool(supplier["activo"])}


def _read_supplier(body):
    """Validates the supplier fields shared by add and edit.

    Returns (fields, None) when it is fine or (None, error response) when it is not.
    """
    if not body:
        return None, _error("supplier data is required")

    nombre = str(body.get("nombre") or "").strip()
    # Optional fields: empty string is saved as NULL
    telefono = str(body.get("telefono") or "").strip() or None
    contacto = str(body.get("contacto") or "").strip() or None
    # HU-09: NIT is optional. Empty is saved as NULL so it does not clash with the UNIQUE.
    # Uppercase so "1234567-k" and "1234567-K" count as the same NIT
    nit = str(body.get("nit") or "").strip().upper() or None

    if not nombre:
        return None, _error("nombre is required")
    if len(nombre) > 100:
        return None, _error("nombre must have at most 100 characters")
    if telefono is not None and len(telefono) > 20:
        return None, _error("telefono must have at most 20 characters")
    if contacto is not None and len(contacto) > 100:
        return None, _error("contacto must have at most 100 characters")
    if nit is not None and len(nit) > 20:
        return None, _error("nit must have at most 20 characters")

    return {"nombre": nombre, "telefono": telefono, "nit": nit, "contacto": contacto}, None


@suppliers.route('api/v1/suppliers', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_suppliers():
    return {
        "status": 0,
        "message": "SUCCESS: suppliers",
        "data": [_supplier_to_json(s) for s in AccessData().get_suppliers()],
    }, 200


@suppliers.route('api/v1/suppliers/<int:supplier_id>', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_supplier(supplier_id):
    supplier = AccessData().get_supplier_by_id(supplier_id)
    if supplier is None:
        return _error("supplier does not exist", 404)
    return {
        "status": 0,
        "message": "SUCCESS: supplier",
        "data": _supplier_to_json(supplier),
    }, 200


@suppliers.route('api/v1/add-supplier', methods=['POST'])
@requiere_rol('admin')  # only the owner registers suppliers
def add_supplier():
    fields, error = _read_supplier(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    if fields["nit"] is not None and access.supplier_nit_exists(fields["nit"]):
        return _error("nit already exists", 409)

    try:
        new_id = access.add_supplier(**fields)
    except pymysql.err.IntegrityError:
        # Two requests with the same NIT at the same time
        return _error("nit already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: supplier created",
        "data": _supplier_to_json(access.get_supplier_by_id(new_id)),
    }, 201


@suppliers.route('api/v1/edit-supplier/<int:supplier_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-09: only the owner edits suppliers
def edit_supplier(supplier_id):
    fields, error = _read_supplier(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    if access.get_supplier_by_id(supplier_id) is None:
        return _error("supplier does not exist", 404)
    # The supplier keeping its own NIT is not a duplicate
    if fields["nit"] is not None and access.supplier_nit_exists(fields["nit"], supplier_id):
        return _error("nit already exists", 409)

    try:
        access.update_supplier(supplier_id, **fields)
    except pymysql.err.IntegrityError:
        return _error("nit already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: supplier updated",
        "data": _supplier_to_json(access.get_supplier_by_id(supplier_id)),
    }, 200


@suppliers.route('api/v1/supplier-status/<int:supplier_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-09: only the owner deactivates suppliers
def set_supplier_status(supplier_id):
    body = request.get_json(silent=True)
    activo = body.get("activo") if isinstance(body, dict) else None
    if not isinstance(activo, bool):
        return _error("activo must be true or false")

    access = AccessData()
    if access.get_supplier_by_id(supplier_id) is None:
        return _error("supplier does not exist", 404)

    # Soft delete: its past entries keep pointing to it
    access.set_supplier_active(supplier_id, activo)

    return {
        "status": 0,
        "message": "SUCCESS: supplier " + ("activated" if activo else "deactivated"),
        "data": _supplier_to_json(access.get_supplier_by_id(supplier_id)),
    }, 200
