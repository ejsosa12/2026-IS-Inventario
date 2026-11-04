from flask import Blueprint, request
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

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
    
    print("login es fine: ", email)
    print("psswd is fine: ", password)

    return {"message": "login ok", "email": email}, 200
