from datetime import datetime, timedelta, timezone
import os

from flask import Blueprint, request
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

from app.access_data import AccessData

auth_user = Blueprint('auth_user', __name__)

@auth_user.route('api/v1/login', methods=['POST'])
def login():
    body = request.get_json(silent=True)

    if not body:
        return {"error": "data login is required"}, 400

    email = body.get("email")
    password = body.get("password")

    # Test if json has attribute query
    if not email:
        return {"error": "email is required"}, 400

    if not password:
        return {"error": "password is required"}, 400

    if not AccessData().user_exists(email, password):
        return {
            "status": 1,
            "message": "ERROR: User does not exist",
            "data": False,
        }, 401

    # JWT_EXPIRES_IN is in hours NOTE: 1 is a default value
    expires_in = int(os.getenv("JWT_EXPIRES_IN", 1)) 
    now = datetime.now(timezone.utc)

    payload = {
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=expires_in),
    }
    token = jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")

    return {
        "status": 0,
        "message": "SUCCESS: Starting user login",
        "data": True,
        "token": token,
    }, 200
