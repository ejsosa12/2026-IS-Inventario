import hashlib
import hmac
import os
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor


class InsufficientStock(Exception):
    """HU-18: an output asks for more than what there is. existencia is what there is."""

    def __init__(self, existencia):
        super().__init__(f"only {existencia} in stock")
        self.existencia = existencia


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
        return hmac.compare_digest(self.hash_password(password), user["password_hash"])

    @staticmethod
    def hash_password(password):
        """Passwords are stored as SHA256 hex for now (same as the seed users in query.sql)."""
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    # ------------------------------------------------------------
    # Users (HU-30): the owner manages who can log in
    # ------------------------------------------------------------

    # Never send password_hash to the client. The PK column is "users", sent as "id"
    USER_COLUMNS = "users AS id, nombre, rol, email, activo"

    def get_users(self):
        """Devuelve todos los usuarios (activos e inactivos) sin su contraseña."""
        query = f"SELECT {self.USER_COLUMNS} FROM users ORDER BY nombre"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_user_by_id(self, user_id):
        """Devuelve el usuario sin su contraseña, o None si no existe."""
        query = f"SELECT {self.USER_COLUMNS} FROM users WHERE users = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": user_id})
                return cursor.fetchone()

    def add_user(self, nombre, email, rol, password):
        """Inserta un usuario nuevo y devuelve su id.

        Lanza pymysql.err.IntegrityError si el correo ya existe.
        """
        query = """
            INSERT INTO users (nombre, rol, email, password_hash)
            VALUES (%(nombre)s, %(rol)s, %(email)s, %(password_hash)s)
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {
                    "nombre": nombre, "rol": rol, "email": email,
                    "password_hash": self.hash_password(password),
                })
                new_id = cursor.lastrowid
            conn.commit()
            return new_id

    def set_user_password(self, user_id, password):
        """HU-30: el dueño le pone una contraseña nueva a un usuario."""
        query = "UPDATE users SET password_hash = %(password_hash)s WHERE users = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": user_id, "password_hash": self.hash_password(password)})
            conn.commit()

    def set_user_active(self, user_id, activo):
        """HU-30: desactiva (o reactiva) un usuario. Sus movimientos se conservan."""
        query = "UPDATE users SET activo = %(activo)s WHERE users = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": user_id, "activo": activo})
            conn.commit()

    # ------------------------------------------------------------
    # Catalog: products and categories
    # ------------------------------------------------------------

    def get_categories(self):
        """HU-05: todas las categorías (activas e inactivas) con cuántos productos tiene cada una."""
        query = """
            SELECT c.id, c.nombre, c.activo, COUNT(p.id) AS productos
            FROM categories c
            LEFT JOIN products p ON p.categoria_id = c.id
            GROUP BY c.id, c.nombre, c.activo
            ORDER BY c.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_category_by_id(self, category_id):
        """HU-05: una categoría con su número de productos, o None."""
        query = """
            SELECT c.id, c.nombre, c.activo, COUNT(p.id) AS productos
            FROM categories c
            LEFT JOIN products p ON p.categoria_id = c.id
            WHERE c.id = %(id)s
            GROUP BY c.id, c.nombre, c.activo
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": category_id})
                return cursor.fetchone()

    def category_name_taken(self, nombre, exclude_id=None):
        """HU-05: True si otra categoría ya usa ese nombre (sin importar mayúsculas)."""
        query = """
            SELECT 1 FROM categories
            WHERE LOWER(nombre) = LOWER(%(nombre)s) AND (%(exclude)s IS NULL OR id <> %(exclude)s)
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"nombre": nombre, "exclude": exclude_id})
                return cursor.fetchone() is not None

    def add_category(self, nombre):
        """HU-05: crea una categoría y devuelve su id. IntegrityError si el nombre ya existe."""
        query = "INSERT INTO categories (nombre) VALUES (%(nombre)s)"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"nombre": nombre})
                new_id = cursor.lastrowid
            conn.commit()
            return new_id

    def rename_category(self, category_id, nombre):
        """HU-05: renombra la categoría; sus productos la siguen teniendo."""
        query = "UPDATE categories SET nombre = %(nombre)s WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": category_id, "nombre": nombre})
            conn.commit()

    def set_category_active(self, category_id, activo):
        """HU-05: desactiva (o reactiva) una categoría. Sus productos no cambian."""
        query = "UPDATE categories SET activo = %(activo)s WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": category_id, "activo": activo})
            conn.commit()

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

    def get_low_stock(self):
        """HU-22: active products with a minimum that are at it or below it.

        HU-21: products without stock_minimo never show up. Out of stock first, then the
        ones furthest from their minimum in percent (2 of 20 sacks before 8 of 10 screws),
        because comparing raw amounts would mix lb, m and units.
        """
        # The stock is computed in a subquery: MariaDB cannot sort by an expression
        # that uses the alias of a SUM
        query = """
            SELECT * FROM (
                SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.stock_minimo,
                       c.nombre AS categoria,
                       COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0)
                           AS existencia
                FROM products p
                LEFT JOIN categories c ON c.id = p.categoria_id
                LEFT JOIN movements m ON m.producto_id = p.id
                WHERE p.activo = true AND p.stock_minimo IS NOT NULL
                GROUP BY p.id, c.nombre
            ) s
            WHERE s.existencia <= s.stock_minimo
            ORDER BY s.existencia > 0,
                     CASE WHEN s.stock_minimo > 0 THEN s.existencia / s.stock_minimo ELSE 1 END,
                     s.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_product_by_id(self, product_id):
        """Devuelve el producto como dict, o None si no existe."""
        query = """
            SELECT id, codigo, nombre, precio, precio_compra, unidad_base, stock_minimo, activo,
                   categoria_id
            FROM products
            WHERE id = %(id)s
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchone()

    def add_product(self, codigo, nombre, precio, unidad_base, stock_minimo=None, categoria_id=None,
                    presentaciones=None):
        """Inserta un producto nuevo (siempre activo) con sus presentaciones y devuelve su id.

        presentaciones: list of {"nombre", "factor"} (HU-06). Product and presentations are
        saved together: if one fails, nothing is saved.
        Lanza pymysql.err.IntegrityError si el código ya existe.
        """
        product_query = """
            INSERT INTO products (codigo, nombre, precio, unidad_base, stock_minimo, activo, categoria_id)
            VALUES (%(codigo)s, %(nombre)s, %(precio)s, %(unidad_base)s, %(stock_minimo)s, true, %(categoria_id)s)
        """
        presentation_query = """
            INSERT INTO presentations (producto_id, nombre, factor)
            VALUES (%(producto_id)s, %(nombre)s, %(factor)s)
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
            try:
                with conn.cursor() as cursor:
                    cursor.execute(product_query, params)
                    new_id = cursor.lastrowid
                    for presentation in presentaciones or []:
                        cursor.execute(presentation_query, {**presentation, "producto_id": new_id})
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            return new_id

    def product_code_taken(self, codigo, exclude_id):
        """True si OTRO producto ya usa ese código (al editar, el propio no cuenta)."""
        query = "SELECT 1 FROM products WHERE codigo = %(codigo)s AND id <> %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"codigo": codigo, "id": exclude_id})
                return cursor.fetchone() is not None

    def product_has_movements(self, product_id):
        """True si el producto ya tuvo entradas o salidas (entonces su unidad no se cambia)."""
        query = "SELECT 1 FROM movements WHERE producto_id = %(id)s LIMIT 1"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchone() is not None

    def update_product(self, product_id, fields, usuario_id):
        """HU-21 / HU-02: guarda los cambios del producto y deja anotado cada cambio de precio.

        fields: codigo, nombre, categoria_id, unidad_base, stock_minimo, precio, precio_compra.
        Product and price history are saved together. Lanza IntegrityError si el código se repite.
        """
        update_query = """
            UPDATE products
            SET codigo = %(codigo)s, nombre = %(nombre)s, categoria_id = %(categoria_id)s,
                unidad_base = %(unidad_base)s, stock_minimo = %(stock_minimo)s,
                precio = %(precio)s, precio_compra = %(precio_compra)s
            WHERE id = %(id)s
        """
        history_query = """
            INSERT INTO price_history (producto_id, tipo, precio_anterior, precio_nuevo, usuario_id)
            VALUES (%(producto_id)s, %(tipo)s, %(anterior)s, %(nuevo)s, %(usuario_id)s)
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    # Lock the row: the old prices read here are the ones being replaced
                    cursor.execute(
                        "SELECT precio, precio_compra FROM products WHERE id = %(id)s FOR UPDATE",
                        {"id": product_id},
                    )
                    old = cursor.fetchone()
                    cursor.execute(update_query, {**fields, "id": product_id})
                    for tipo, column in (("venta", "precio"), ("compra", "precio_compra")):
                        if fields[column] is not None and fields[column] != old[column]:
                            cursor.execute(history_query, {
                                "producto_id": product_id, "tipo": tipo,
                                "anterior": old[column], "nuevo": fields[column],
                                "usuario_id": usuario_id,
                            })
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def get_price_history(self, product_id):
        """HU-02: los cambios de precio del producto, el más reciente primero."""
        query = """
            SELECT h.id, h.tipo, h.precio_anterior, h.precio_nuevo, h.fecha, u.nombre AS usuario
            FROM price_history h
            JOIN users u ON u.users = h.usuario_id
            WHERE h.producto_id = %(id)s
            ORDER BY h.fecha DESC, h.id DESC
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchall()

    def get_presentations_by_product(self, product_id):
        """Devuelve las presentaciones de un producto, de la más chica a la más grande."""
        query = """
            SELECT id, producto_id, nombre, factor
            FROM presentations
            WHERE producto_id = %(id)s
            ORDER BY factor
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchall()

    # ------------------------------------------------------------
    # Suppliers
    # ------------------------------------------------------------

    SUPPLIER_COLUMNS = "id, nombre, telefono, contacto, nit, activo"

    def get_suppliers(self):
        """Devuelve todos los proveedores (activos e inactivos) ordenados por nombre."""
        query = f"SELECT {self.SUPPLIER_COLUMNS} FROM suppliers ORDER BY nombre"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_supplier_by_id(self, supplier_id):
        """Devuelve el proveedor como dict, o None si no existe."""
        query = f"SELECT {self.SUPPLIER_COLUMNS} FROM suppliers WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": supplier_id})
                return cursor.fetchone()

    def supplier_nit_exists(self, nit, exclude_id=None):
        """True si ya hay otro proveedor con ese NIT.

        exclude_id: al editar, el propio proveedor no cuenta como repetido.
        """
        query = "SELECT 1 FROM suppliers WHERE nit = %(nit)s AND id <> %(exclude_id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"nit": nit, "exclude_id": exclude_id or 0})
                return cursor.fetchone() is not None

    def add_supplier(self, nombre, telefono=None, nit=None, contacto=None):
        """Inserta un proveedor nuevo y devuelve su id.

        Lanza pymysql.err.IntegrityError si el NIT ya existe.
        """
        query = """
            INSERT INTO suppliers (nombre, telefono, contacto, nit)
            VALUES (%(nombre)s, %(telefono)s, %(contacto)s, %(nit)s)
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {
                    "nombre": nombre, "telefono": telefono, "contacto": contacto, "nit": nit,
                })
                new_id = cursor.lastrowid
            conn.commit()
            return new_id

    def update_supplier(self, supplier_id, nombre, telefono=None, nit=None, contacto=None):
        """HU-09: edita los datos del proveedor (no su estado).

        Lanza pymysql.err.IntegrityError si el NIT ya existe.
        """
        query = """
            UPDATE suppliers
            SET nombre = %(nombre)s, telefono = %(telefono)s, contacto = %(contacto)s, nit = %(nit)s
            WHERE id = %(id)s
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {
                    "id": supplier_id, "nombre": nombre, "telefono": telefono,
                    "contacto": contacto, "nit": nit,
                })
            conn.commit()

    def set_supplier_active(self, supplier_id, activo):
        """HU-09: desactiva (o reactiva) un proveedor sin borrar sus entradas."""
        query = "UPDATE suppliers SET activo = %(activo)s WHERE id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": supplier_id, "activo": activo})
            conn.commit()

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
                        # HU-02: the invoice price becomes the product's purchase price.
                        # No price_history row: the invoice itself records who, when and how much
                        cursor.execute(
                            "UPDATE products SET precio_compra = %(precio)s WHERE id = %(producto_id)s",
                            item,
                        )
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

    # ------------------------------------------------------------
    # Outputs (HU-16 merma; HU-17 uso interno later; sales come from billing, see
    # facturación-conditions.txt). HU-18: never leave the stock below zero
    # ------------------------------------------------------------

    @staticmethod
    def _lock_stock(cursor, producto_id):
        """HU-18: locks the product row until commit and returns its current stock.

        Two people taking the last 5 sacks at the same time: the second one waits here
        and then sees the stock the first one left. Must run inside a transaction.
        Reusable by any outgoing movement (merma, uso interno, ventas).
        """
        cursor.execute("SELECT id FROM products WHERE id = %(id)s FOR UPDATE", {"id": producto_id})
        cursor.execute("""
            SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END), 0)
                   AS existencia
            FROM movements
            WHERE producto_id = %(id)s
        """, {"id": producto_id})
        return cursor.fetchone()["existencia"]

    @staticmethod
    def _last_purchase_price(cursor, producto_id):
        """The product's purchase price per base unit (HU-02), or None if it was never bought.

        Each invoice updates it and the owner can correct it. Saved on outputs so later
        reports can tell how much money was lost (merma) or used inside the store (uso interno).
        """
        cursor.execute("SELECT precio_compra FROM products WHERE id = %(id)s", {"id": producto_id})
        row = cursor.fetchone()
        return row["precio_compra"] if row else None

    def add_output(self, tipo, producto_id, cantidad, motivo, usuario_id):
        """Guarda una salida ('dano' o 'uso') con su costo y devuelve su id.

        cantidad is already in the base unit. Lanza InsufficientStock si no alcanza (HU-18).
        """
        query = """
            INSERT INTO movements (tipo, cantidad, precio, motivo, producto_id, usuario_id)
            VALUES (%(tipo)s, %(cantidad)s, %(precio)s, %(motivo)s, %(producto_id)s, %(usuario_id)s)
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    existencia = self._lock_stock(cursor, producto_id)
                    if cantidad > existencia:
                        raise InsufficientStock(existencia)
                    cursor.execute(query, {
                        "tipo": tipo, "cantidad": cantidad, "motivo": motivo,
                        "precio": self._last_purchase_price(cursor, producto_id),
                        "producto_id": producto_id, "usuario_id": usuario_id,
                    })
                    output_id = cursor.lastrowid
                conn.commit()
            except Exception:
                # Also releases the lock
                conn.rollback()
                raise
            return output_id

    OUTPUT_SELECT = """
        SELECT m.id, m.tipo, m.cantidad, m.precio, m.motivo, m.fecha,
               m.producto_id, p.codigo, p.nombre AS producto, p.unidad_base,
               m.usuario_id, u.nombre AS usuario
        FROM movements m
        JOIN products p ON p.id = m.producto_id
        JOIN users u ON u.users = m.usuario_id
    """

    def get_outputs(self, tipos, limit=100):
        """Devuelve las últimas salidas de esos tipos, la más reciente primero."""
        placeholders = ", ".join(["%s"] * len(tipos))
        query = self.OUTPUT_SELECT + f"WHERE m.tipo IN ({placeholders}) ORDER BY m.fecha DESC, m.id DESC LIMIT %s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, (*tipos, limit))
                return cursor.fetchall()

    def get_output_by_id(self, output_id):
        """Devuelve una salida, o None si no existe."""
        query = self.OUTPUT_SELECT + "WHERE m.id = %(id)s"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": output_id})
                return cursor.fetchone()
