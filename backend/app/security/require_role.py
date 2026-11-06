from functools import wraps
import os

from flask import g, request
import jwt

from app.access_data import AccessData


def _error(message, code):
    return {"status": 1, "message": message, "data": None}, code


def requiere_rol(*roles):
    """Protects a route: requires a valid JWT and, if roles are given, one of those roles.

    Usage:
        @requiere_rol('admin')              -> only admin
        @requiere_rol('admin', 'employee')  -> any logged-in user with one of those roles
        @requiere_rol()                     -> any logged-in user

    Responses:
        401 -> no token, invalid, expired, or the user no longer exists / is inactive.
               Angular's auth-interceptor closes the session on 401.
        403 -> the token is fine but the role is not allowed (the session stays open).

    The logged-in user is left in flask.g.user so the route can use it
    (for example, movements need usuario_id).
    """
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            scheme, _, token = header.partition(" ")
            if scheme != "Bearer" or not token:
                return _error("token is required", 401)

            try:
                # Checks the signature and the "exp" date
                payload = jwt.decode(token, os.getenv("JWT_SECRET"), algorithms=["HS256"])
            except jwt.ExpiredSignatureError:
                return _error("token expired", 401)
            except jwt.InvalidTokenError:
                return _error("invalid token", 401)

            # The token only has the email. The role is read from the database on every request,
            # so if the owner changes a role or deactivates someone, it applies right away.
            user = AccessData().get_user_by_email(payload.get("email"))
            # HU-30: an inactive user is rejected even if their token has not expired yet
            if user is None or not user["activo"]:
                return _error("user is not active", 401)

            if roles and user["rol"] not in roles:
                return _error("you do not have permission to do this", 403)

            g.user = user
            return view(*args, **kwargs)
        return wrapper
    return decorator
