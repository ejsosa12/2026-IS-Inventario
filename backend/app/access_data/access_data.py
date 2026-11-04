import hashlib
import hmac
import os
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor


class AccessData:
    """Acceso a la base de datos MySQL local.

    La configuración se toma de variables de entorno (.env) si no se pasa
    explícitamente: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
    """

    def __init__(self, host=None, port=None, user=None, password=None, database=None):
        self.config = {
            "host": host or os.getenv("DB_HOST", "localhost"),
            "port": int(port or os.getenv("DB_PORT", 3306)),
            "user": user or os.getenv("DB_USER", "root"),
            "password": password or os.getenv("DB_PASSWORD", ""),
            "database": database or os.getenv("DB_NAME", "inventario"),
            "cursorclass": DictCursor,
            "charset": "utf8mb4",
        }

    @contextmanager
    def _connection(self):
        """Abre una conexión y la cierra siempre al terminar."""
        conn = pymysql.connect(**self.config)
        try:
            yield conn
        finally:
            conn.close()

    def get_user_by_email(self, email):
        """Devuelve el usuario como dict, o None si no existe."""
        query = "SELECT users, nombre, rol, email, password_hash FROM users WHERE email = %(email)s"
        params = {"email": email}
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                return cursor.fetchone()

    def user_exists(self, email, password):
        """True si existe un usuario con ese correo y la contraseña coincide."""
        user = self.get_user_by_email(email)
        if user is None:
            return False
        # Passwords are stored as SHA256 hex for now
        password_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(password_hash, user["password_hash"])
