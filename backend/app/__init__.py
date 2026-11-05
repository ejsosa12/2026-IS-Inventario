from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv
import os

# Load environment variables from the .env file
load_dotenv()

flask_key = os.getenv("FLASK_KEY")


def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = flask_key

    # Allow the Angular dev server to call the API
    CORS(app, origins=["http://localhost:4200"])

    # Error handler
    @app.errorhandler(404)
    def not_found(error):
        return {"error": "Endpoint not found"}, 404

    from .auth import auth_user

    app.register_blueprint(auth_user, url_prefix='/')

    return app
