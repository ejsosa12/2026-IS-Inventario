from flask import Blueprint, g, request
import pymysql

from app.access_data import AccessData
from app.security import requiere_rol

users = Blueprint('users', __name__)

ROLES = ("admin", "employee")
PASSWORD_MIN = 6


def _error(message, code=400):
    return {"status": 1, "message": message, "data": None}, code


def _user_to_json(user):
    """activo comes from the DB as 0/1; Angular expects true/false."""
    return {**user, "activo": bool(user["activo"])}


def _read_password(body):
    """Returns (password, None) or (None, error response)."""
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(password, str) or not password:
        return None, _error("password is required")
    if len(password) < PASSWORD_MIN:
        return None, _error(f"password must have at least {PASSWORD_MIN} characters")
    if len(password) > 100:
        return None, _error("password must have at most 100 characters")
    return password, None


@users.route('api/v1/users', methods=['GET'])
@requiere_rol('admin')  # HU-30: only the owner manages users
def get_users():
    return {
        "status": 0,
        "message": "SUCCESS: users",
        "data": [_user_to_json(u) for u in AccessData().get_users()],
    }, 200


@users.route('api/v1/add-user', methods=['POST'])
@requiere_rol('admin')
def add_user():
    body = request.get_json(silent=True)
    if not body:
        return _error("user data is required")

    nombre = str(body.get("nombre") or "").strip()
    # Lowercase so "Kevin@elclavo.com" and "kevin@elclavo.com" are the same login
    email = str(body.get("email") or "").strip().lower()
    rol = body.get("rol")

    if not nombre:
        return _error("nombre is required")
    if len(nombre) > 100:
        return _error("nombre must have at most 100 characters")
    if not email or "@" not in email or " " in email:
        return _error("email is not valid")
    if len(email) > 50:
        return _error("email must have at most 50 characters")
    # HU-30: the role is chosen here and cannot be changed later (there is no route for it)
    if rol not in ROLES:
        return _error("rol must be admin or employee")

    password, error = _read_password(body)
    if error:
        return error

    access = AccessData()
    if access.get_user_by_email(email) is not None:
        return _error("email already exists", 409)

    try:
        new_id = access.add_user(nombre, email, rol, password)
    except pymysql.err.IntegrityError:
        return _error("email already exists", 409)

    return {
        "status": 0,
        "message": "SUCCESS: user created",
        "data": _user_to_json(access.get_user_by_id(new_id)),
    }, 201


@users.route('api/v1/user-password/<int:user_id>', methods=['PUT'])
@requiere_rol('admin')  # HU-30: the owner changes passwords
def change_password(user_id):
    password, error = _read_password(request.get_json(silent=True))
    if error:
        return error

    access = AccessData()
    if access.get_user_by_id(user_id) is None:
        return _error("user does not exist", 404)

    access.set_user_password(user_id, password)
    return {
        "status": 0,
        "message": "SUCCESS: password changed",
        "data": _user_to_json(access.get_user_by_id(user_id)),
    }, 200


@users.route('api/v1/user-status/<int:user_id>', methods=['PUT'])
@requiere_rol('admin')
def set_user_status(user_id):
    body = request.get_json(silent=True)
    activo = body.get("activo") if isinstance(body, dict) else None
    if not isinstance(activo, bool):
        return _error("activo must be true or false")

    # The owner cannot lock themselves out
    if user_id == g.user["users"] and not activo:
        return _error("you cannot deactivate yourself")

    access = AccessData()
    if access.get_user_by_id(user_id) is None:
        return _error("user does not exist", 404)

    # HU-30: soft delete. requiere_rol rejects them on the next request; their movements stay
    access.set_user_active(user_id, activo)
    return {
        "status": 0,
        "message": "SUCCESS: user " + ("activated" if activo else "deactivated"),
        "data": _user_to_json(access.get_user_by_id(user_id)),
    }, 200
