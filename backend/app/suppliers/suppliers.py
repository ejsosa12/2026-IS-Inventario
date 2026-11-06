from flask import Blueprint, request
import pymysql

from app.access_data import AccessData
from app.security import requiere_rol

suppliers = Blueprint('suppliers', __name__)


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


@suppliers.route('api/v1/suppliers', methods=['GET'])
@requiere_rol()  # any logged-in user
def get_suppliers():
    return {
        "status": 0,
        "message": "SUCCESS: suppliers",
        "data": AccessData().get_suppliers(),
    }, 200


@suppliers.route('api/v1/add-supplier', methods=['POST'])
@requiere_rol('admin')  # only the owner registers suppliers
def add_supplier():
    body = request.get_json(silent=True)

    if not body:
        return _error("supplier data is required")

    nombre = str(body.get("nombre") or "").strip()
    # telefono is optional: empty string is saved as NULL
    telefono = str(body.get("telefono") or "").strip() or None
    # HU-09: NIT is optional. Empty is saved as NULL so it does not clash with the UNIQUE.
    # Uppercase so "1234567-k" and "1234567-K" count as the same NIT
    nit = str(body.get("nit") or "").strip().upper() or None

    if not nombre:
        return _error("nombre is required")
    if len(nombre) > 100:
        return _error("nombre must have at most 100 characters")
    if telefono is not None and len(telefono) > 20:
        return _error("telefono must have at most 20 characters")
    if nit is not None and len(nit) > 20:
        return _error("nit must have at most 20 characters")

    access = AccessData()
    if nit is not None and access.supplier_nit_exists(nit):
        return _error("nit already exists", 409)

    try:
        new_id = access.add_supplier(nombre, telefono, nit)
    except pymysql.err.IntegrityError:
        # Two requests with the same NIT at the same time
        return _error("nit already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: supplier created",
        "data": access.get_supplier_by_id(new_id),
    }, 201
