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
        query = "SELECT users, nombre, rol, email, password_hash, activo FROM users WHERE email = %(email)s"
        params = {"email": email}
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                return cursor.fetchone()

    def user_exists(self, email, password):
        """True si existe un usuario activo con ese correo y la contraseña coincide."""
        user = self.get_user_by_email(email)
        # HU-30: an inactive user cannot log in
        if user is None or not user["activo"]:
            return False
        # Passwords are stored as SHA256 hex for now
        password_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(password_hash, user["password_hash"])

    # ------------------------------------------------------------
    # Catalog: products and categories
    # ------------------------------------------------------------

    def get_categories(self):
        """Devuelve todas las categorías ordenadas por nombre."""
        query = "SELECT id, nombre FROM categories ORDER BY nombre"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_presentations(self):
        """Devuelve todas las presentaciones (HU-06: 1 caja = 50 lb)."""
        query = """
            SELECT id, producto_id, nombre, factor
            FROM presentations
            ORDER BY producto_id, factor
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

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

    def get_products(self):
        """Devuelve todos los productos con su categoría y su existencia actual.

        La existencia no se guarda en products: se calcula con los movimientos
        (las entradas suman; venta, daño y uso restan).
        """
        query = """
            SELECT p.id, p.codigo, p.nombre, p.precio, p.unidad_base, p.stock_minimo, p.activo,
                   p.categoria_id, c.nombre AS categoria,
                   COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0) AS existencia
            FROM products p
            LEFT JOIN categories c ON c.id = p.categoria_id
            LEFT JOIN movements m ON m.producto_id = p.id
            GROUP BY p.id, c.nombre
            ORDER BY p.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

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

    # ------------------------------------------------------------
    # Suppliers
    # ------------------------------------------------------------

    def get_suppliers(self):
        """Devuelve todos los proveedores ordenados por nombre."""
        query = "SELECT id, nombre, telefono, nit FROM suppliers ORDER BY nombre"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_supplier_by_id(self, supplier_id):
        """Devuelve el proveedor como dict, o None si no existe."""
        query = "SELECT id, nombre, telefono, nit FROM suppliers WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": supplier_id})
                return cursor.fetchone()

    def supplier_nit_exists(self, nit):
        """True si ya hay un proveedor con ese NIT."""
        query = "SELECT 1 FROM suppliers WHERE nit = %(nit)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"nit": nit})
                return cursor.fetchone() is not None

    def add_supplier(self, nombre, telefono=None, nit=None):
        """Inserta un proveedor nuevo y devuelve su id.

        Lanza pymysql.err.IntegrityError si el NIT ya existe.
        """
        query = "INSERT INTO suppliers (nombre, telefono, nit) VALUES (%(nombre)s, %(telefono)s, %(nit)s)"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"nombre": nombre, "telefono": telefono, "nit": nit})
                new_id = cursor.lastrowid
            conn.commit()
            return new_id

    # ------------------------------------------------------------
    # Entries (HU-11, HU-12): an invoice header in entries,
    # one 'entrada' movement per product
    # ------------------------------------------------------------

    def get_presentation_by_id(self, presentation_id):
        """Devuelve la presentación como dict, o None si no existe."""
        query = "SELECT id, producto_id, nombre, factor FROM presentations WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": presentation_id})
                return cursor.fetchone()

    def entry_exists(self, proveedor_id, numero_factura):
        """True si esa factura de ese proveedor ya fue ingresada."""
        query = """
            SELECT 1 FROM entries
            WHERE proveedor_id = %(proveedor_id)s AND numero_factura = %(numero_factura)s
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"proveedor_id": proveedor_id, "numero_factura": numero_factura})
                return cursor.fetchone() is not None

    def add_entry(self, proveedor_id, numero_factura, fecha_factura, usuario_id, items):
        """Guarda la factura y un movimiento 'entrada' por producto. Todo o nada.

        items: dicts with producto_id, presentacion_id, cantidad, cantidad_factura and precio,
        already converted to the base unit.
        Lanza pymysql.err.IntegrityError si la factura ya existe.
        """
        entry_query = """
            INSERT INTO entries (proveedor_id, numero_factura, fecha_factura, usuario_id)
            VALUES (%(proveedor_id)s, %(numero_factura)s, %(fecha_factura)s, %(usuario_id)s)
        """
        movement_query = """
            INSERT INTO movements (tipo, cantidad, cantidad_factura, precio, producto_id,
                                   usuario_id, proveedor_id, entrada_id, presentacion_id)
            VALUES ('entrada', %(cantidad)s, %(cantidad_factura)s, %(precio)s, %(producto_id)s,
                    %(usuario_id)s, %(proveedor_id)s, %(entrada_id)s, %(presentacion_id)s)
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute(entry_query, {
                        "proveedor_id": proveedor_id,
                        "numero_factura": numero_factura,
                        "fecha_factura": fecha_factura,
                        "usuario_id": usuario_id,
                    })
                    entry_id = cursor.lastrowid
                    for item in items:
                        cursor.execute(movement_query, {
                            **item,
                            "usuario_id": usuario_id,
                            "proveedor_id": proveedor_id,
                            "entrada_id": entry_id,
                        })
                conn.commit()
            except Exception:
                # If one product fails, the invoice is not saved half done
                conn.rollback()
                raise
            return entry_id

    def get_entries(self, only_with_shortages=False):
        """Devuelve las facturas ingresadas, la más reciente primero.

        con_faltantes is 1 when some product arrived in a different quantity than the invoice (HU-12).
        """
        query = """
            SELECT e.id, e.numero_factura, e.fecha_factura, e.fecha,
                   e.proveedor_id, s.nombre AS proveedor,
                   e.usuario_id, u.nombre AS usuario,
                   COUNT(m.id) AS total_productos,
                   MAX(m.cantidad_factura <> m.cantidad) AS con_faltantes
            FROM entries e
            JOIN suppliers s ON s.id = e.proveedor_id
            JOIN users u ON u.users = e.usuario_id
            LEFT JOIN movements m ON m.entrada_id = e.id
            GROUP BY e.id, s.nombre, u.nombre
        """
        if only_with_shortages:
            query += " HAVING con_faltantes = 1"
        query += " ORDER BY e.fecha DESC, e.id DESC"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_entry_by_id(self, entry_id):
        """Devuelve la factura con sus productos, o None si no existe."""
        entry_query = """
            SELECT e.id, e.numero_factura, e.fecha_factura, e.fecha,
                   e.proveedor_id, s.nombre AS proveedor,
                   e.usuario_id, u.nombre AS usuario
            FROM entries e
            JOIN suppliers s ON s.id = e.proveedor_id
            JOIN users u ON u.users = e.usuario_id
            WHERE e.id = %(id)s
        """
        items_query = """
            SELECT m.id, m.producto_id, p.codigo, p.nombre, p.unidad_base,
                   m.presentacion_id, pr.nombre AS presentacion, pr.factor,
                   m.cantidad, m.cantidad_factura, m.precio
            FROM movements m
            JOIN products p ON p.id = m.producto_id
            LEFT JOIN presentations pr ON pr.id = m.presentacion_id
            WHERE m.entrada_id = %(id)s
            ORDER BY m.id
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(entry_query, {"id": entry_id})
                entry = cursor.fetchone()
                if entry is None:
                    return None
                cursor.execute(items_query, {"id": entry_id})
                entry["productos"] = cursor.fetchall()
                return entry
