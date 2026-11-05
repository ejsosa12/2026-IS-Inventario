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

    # ------------------------------------------------------------
    # Catalog: products and categories
    # ------------------------------------------------------------

    def category_exists(self, category_id):
        """True si existe una categoría con ese id."""
        query = "SELECT 1 FROM categories WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": category_id})
                return cursor.fetchone() is not None

    def product_code_exists(self, codigo):
        """True si ya hay un producto con ese código (activo o no)."""
        query = "SELECT 1 FROM products WHERE codigo = %(codigo)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"codigo": codigo})
                return cursor.fetchone() is not None

    def get_product_by_id(self, product_id):
        """Devuelve el producto como dict, o None si no existe."""
        query = """
            SELECT id, codigo, nombre, precio, unidad_base, stock_minimo, activo, categoria_id
            FROM products
            WHERE id = %(id)s
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchone()

    def add_product(self, codigo, nombre, precio, unidad_base, stock_minimo=None, categoria_id=None):
        """Inserta un producto nuevo (siempre activo) y devuelve su id.

        Lanza pymysql.err.IntegrityError si el código ya existe.
        """
        query = """
            INSERT INTO products (codigo, nombre, precio, unidad_base, stock_minimo, activo, categoria_id)
            VALUES (%(codigo)s, %(nombre)s, %(precio)s, %(unidad_base)s, %(stock_minimo)s, true, %(categoria_id)s)
        """
        params = {
            "codigo": codigo,
            "nombre": nombre,
            "precio": precio,
            "unidad_base": unidad_base,
            "stock_minimo": stock_minimo,
            "categoria_id": categoria_id,
        }
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                new_id = cursor.lastrowid
            conn.commit()
            return new_id
