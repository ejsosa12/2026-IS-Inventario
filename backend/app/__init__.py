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
    from .catalog import catalog
    from .suppliers import suppliers
    from .movements import movements
    from .users import users

    app.register_blueprint(auth_user, url_prefix='/')
    app.register_blueprint(catalog, url_prefix='/')
    app.register_blueprint(suppliers, url_prefix='/')
    app.register_blueprint(movements, url_prefix='/')
    app.register_blueprint(users, url_prefix='/')

    return app
