import hashlib
import hmac
import os
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

# How one movement changes the stock (in SQL, on a `movements m` row): entrada,
# ajuste_mas (HU-34) and inicial (HU-31) add; venta, dano, uso, anulacion and
# ajuste_menos subtract.
# Every stock query uses this, so a new movement type is added in one place.
STOCK_CHANGE = ("CASE WHEN m.tipo IN ('entrada', 'ajuste_mas', 'inicial') "
                "THEN m.cantidad ELSE -m.cantidad END")


class InsufficientStock(Exception):
    """HU-18: an output asks for more than what there is. existencia is what there is."""

    def __init__(self, existencia):
        super().__init__(f"only {existencia} in stock")
        self.existencia = existencia


class NegativeStock(Exception):
    """HU-14 + HU-18: voiding or correcting an entry would leave some product below 0.

    productos: dicts with producto_id, codigo, nombre, unidad_base, existencia and quedaria.
    """

    def __init__(self, productos):
        super().__init__("stock would be negative")
        self.productos = productos


class EntryAlreadyVoided(Exception):
    """HU-14: the entry is already voided (maybe someone else voided it a moment ago)."""


class CountAlreadyOpen(Exception):
    """HU-32: only one physical count can be open at a time (uq_counts_abierto)."""


class CountNotOpen(Exception):
    """HU-33: the count was applied or cancelled (maybe a moment ago), it cannot change."""


class ProductHasMovements(Exception):
    """HU-31: initial stock only goes to products without movements (it is the starting point).

    codigos: the products that got movements since the file was checked.
    """

    def __init__(self, codigos):
        super().__init__("products already have movements")
        self.codigos = codigos


class CountChanged(Exception):
    """HU-34: the difference the owner approved is not the one there is now (an invoice,
    an output or a corrected sheet came in while they were reviewing).

    productos: dicts with producto_id, codigo, nombre, unidad_base, existencia, contado,
    diferencia (now) and aprobada (what the owner saw).
    """

    def __init__(self, productos):
        super().__init__("the differences changed")
        self.productos = productos


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
        query = f"""
            SELECT p.id, p.codigo, p.nombre, p.precio, p.unidad_base, p.stock_minimo, p.activo,
                   p.categoria_id, c.nombre AS categoria,
                   COALESCE(SUM({STOCK_CHANGE}), 0) AS existencia
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
        query = f"""
            SELECT * FROM (
                SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.stock_minimo,
                       c.nombre AS categoria,
                       COALESCE(SUM({STOCK_CHANGE}), 0)
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

    PRODUCT_INSERT = """
        INSERT INTO products (codigo, nombre, precio, precio_compra, unidad_base, stock_minimo,
                              activo, categoria_id)
        VALUES (%(codigo)s, %(nombre)s, %(precio)s, %(precio_compra)s, %(unidad_base)s,
                %(stock_minimo)s, true, %(categoria_id)s)
    """

    @staticmethod
    def _insert_initial_stock(cursor, producto_id, existencia, precio_compra, usuario_id, motivo=None):
        """HU-31: the stock a product starts with, as one 'inicial' movement (it adds)."""
        cursor.execute("""
            INSERT INTO movements (tipo, cantidad, precio, motivo, producto_id, usuario_id)
            VALUES ('inicial', %(cantidad)s, %(precio)s, %(motivo)s, %(producto_id)s, %(usuario_id)s)
        """, {"cantidad": existencia, "precio": precio_compra, "motivo": motivo,
              "producto_id": producto_id, "usuario_id": usuario_id})

    def add_product(self, codigo, nombre, precio, unidad_base, stock_minimo=None, categoria_id=None,
                    presentaciones=None, precio_compra=None, existencia=0, usuario_id=None):
        """Inserta un producto nuevo (siempre activo) con sus presentaciones y devuelve su id.

        presentaciones: list of {"nombre", "factor"} (HU-06). HU-31 by hand: precio_compra and
        existencia (initial stock, saved as an 'inicial' movement by usuario_id).
        Everything is saved together: if one fails, nothing is saved.
        Lanza pymysql.err.IntegrityError si el código ya existe.
        """
        product_query = self.PRODUCT_INSERT
        presentation_query = """
            INSERT INTO presentations (producto_id, nombre, factor)
            VALUES (%(producto_id)s, %(nombre)s, %(factor)s)
        """
        params = {
            "codigo": codigo,
            "nombre": nombre,
            "precio": precio,
            "precio_compra": precio_compra,
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
                    if existencia:
                        self._insert_initial_stock(cursor, new_id, existencia, precio_compra, usuario_id)
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

    def entry_exists(self, proveedor_id, numero_factura, exclude_id=None):
        """True si esa factura de ese proveedor ya fue ingresada y no está anulada.

        HU-14: a voided invoice can be entered again. exclude_id is the entry being corrected.
        """
        query = """
            SELECT 1 FROM entries
            WHERE proveedor_id = %(proveedor_id)s AND factura_vigente = %(numero_factura)s
              AND (%(exclude)s IS NULL OR id <> %(exclude)s)
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {
                    "proveedor_id": proveedor_id, "numero_factura": numero_factura,
                    "exclude": exclude_id,
                })
                return cursor.fetchone() is not None

    @staticmethod
    def _insert_entry(cursor, proveedor_id, numero_factura, fecha_factura, usuario_id, items):
        """Inserts the invoice header and one 'entrada' per line. Returns the entry id.

        items: dicts with producto_id, presentacion_id, cantidad, cantidad_factura and precio,
        already converted to the base unit. Must run inside a transaction.
        """
        cursor.execute("""
            INSERT INTO entries (proveedor_id, numero_factura, fecha_factura, usuario_id)
            VALUES (%(proveedor_id)s, %(numero_factura)s, %(fecha_factura)s, %(usuario_id)s)
        """, {
            "proveedor_id": proveedor_id,
            "numero_factura": numero_factura,
            "fecha_factura": fecha_factura,
            "usuario_id": usuario_id,
        })
        entry_id = cursor.lastrowid
        for item in items:
            cursor.execute("""
                INSERT INTO movements (tipo, cantidad, cantidad_factura, precio, producto_id,
                                       usuario_id, proveedor_id, entrada_id, presentacion_id)
                VALUES ('entrada', %(cantidad)s, %(cantidad_factura)s, %(precio)s, %(producto_id)s,
                        %(usuario_id)s, %(proveedor_id)s, %(entrada_id)s, %(presentacion_id)s)
            """, {
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
        return entry_id

    def add_entry(self, proveedor_id, numero_factura, fecha_factura, usuario_id, items):
        """Guarda la factura y un movimiento 'entrada' por producto. Todo o nada.

        Lanza pymysql.err.IntegrityError si la factura ya existe (y no está anulada).
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    entry_id = self._insert_entry(
                        cursor, proveedor_id, numero_factura, fecha_factura, usuario_id, items
                    )
                conn.commit()
            except Exception:
                # If one product fails, the invoice is not saved half done
                conn.rollback()
                raise
            return entry_id

    # Header columns shared by the entry list and the entry detail
    ENTRY_COLUMNS = """
        e.id, e.numero_factura, e.fecha_factura, e.fecha,
        e.proveedor_id, s.nombre AS proveedor,
        e.usuario_id, u.nombre AS usuario,
        e.anulada_en, e.anulada_por AS anulada_por_id, ua.nombre AS anulada_por,
        e.motivo_anulacion
    """

    def get_entries(self, only_with_shortages=False):
        """Devuelve las facturas ingresadas, la más reciente primero.

        con_faltantes is 1 when some product arrived in a different quantity than the invoice (HU-12).
        HU-14: voided entries are listed too (with who, when and why), except with only_with_shortages.
        """
        query = f"""
            SELECT {self.ENTRY_COLUMNS},
                   COUNT(m.id) AS total_productos,
                   MAX(m.cantidad_factura <> m.cantidad) AS con_faltantes
            FROM entries e
            JOIN suppliers s ON s.id = e.proveedor_id
            JOIN users u ON u.users = e.usuario_id
            LEFT JOIN users ua ON ua.users = e.anulada_por
            -- Only the 'entrada' rows: the 'anulacion' rows of a voided entry are not products
            LEFT JOIN movements m ON m.entrada_id = e.id AND m.tipo = 'entrada'
        """
        if only_with_shortages:
            query += " WHERE e.anulada_en IS NULL"
        query += " GROUP BY e.id, s.nombre, u.nombre, ua.nombre"
        if only_with_shortages:
            query += " HAVING con_faltantes = 1"
        query += " ORDER BY e.fecha DESC, e.id DESC"
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_entry_by_id(self, entry_id):
        """Devuelve la factura con sus productos, o None si no existe."""
        entry_query = f"""
            SELECT {self.ENTRY_COLUMNS}
            FROM entries e
            JOIN suppliers s ON s.id = e.proveedor_id
            JOIN users u ON u.users = e.usuario_id
            LEFT JOIN users ua ON ua.users = e.anulada_por
            WHERE e.id = %(id)s
        """
        items_query = """
            SELECT m.id, m.producto_id, p.codigo, p.nombre, p.unidad_base,
                   m.presentacion_id, pr.nombre AS presentacion, pr.factor,
                   m.cantidad, m.cantidad_factura, m.precio
            FROM movements m
            JOIN products p ON p.id = m.producto_id
            LEFT JOIN presentations pr ON pr.id = m.presentacion_id
            WHERE m.entrada_id = %(id)s AND m.tipo = 'entrada'
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
    # HU-14: void or correct an entry. Nothing is deleted: each line gets an
    # 'anulacion' movement that subtracts it, and the entry is marked as voided
    # ------------------------------------------------------------

    @staticmethod
    def _lock_entry_lines(cursor, entry_id):
        """Locks the entry until commit and returns its 'entrada' lines.

        Raises EntryAlreadyVoided if it was voided (two people voiding it at the same time).
        """
        cursor.execute(
            "SELECT anulada_en FROM entries WHERE id = %(id)s FOR UPDATE", {"id": entry_id}
        )
        entry = cursor.fetchone()
        if entry is None or entry["anulada_en"] is not None:
            raise EntryAlreadyVoided()
        cursor.execute("""
            SELECT id, producto_id, presentacion_id, proveedor_id, cantidad, precio, fecha
            FROM movements
            WHERE entrada_id = %(id)s AND tipo = 'entrada'
            ORDER BY id
        """, {"id": entry_id})
        return cursor.fetchall()

    def _check_stock_change(self, cursor, changes):
        """HU-18 for HU-14: the stock never goes below 0.

        changes: {producto_id: Decimal}, what each product gains (+) or loses (-).
        Locks every product that loses stock, in id order so two transactions never wait
        on each other, and raises NegativeStock listing the ones that would end below 0.
        """
        problems = []
        for producto_id in sorted(changes):
            if changes[producto_id] >= 0:
                continue
            existencia = self._lock_stock(cursor, producto_id)
            if existencia + changes[producto_id] < 0:
                problems.append({
                    "producto_id": producto_id,
                    "existencia": existencia,
                    "quedaria": existencia + changes[producto_id],
                })
        if problems:
            cursor.execute(
                "SELECT id, codigo, nombre, unidad_base FROM products WHERE id IN %(ids)s",
                {"ids": [p["producto_id"] for p in problems]},
            )
            products = {row["id"]: row for row in cursor.fetchall()}
            for problem in problems:
                product = products[problem["producto_id"]]
                problem.update(
                    codigo=product["codigo"], nombre=product["nombre"],
                    unidad_base=product["unidad_base"],
                )
            raise NegativeStock(problems)

    @staticmethod
    def _restore_purchase_price(cursor, line):
        """Point 6 of HU-14: after voiding, put back the price of the last valid invoice.

        Only when this voided line is what set the current purchase price: no valid invoice
        of the product came after it and the owner did not change the price by hand since.
        If there is no other valid invoice, the price is left as it is.
        """
        params = {"producto_id": line["producto_id"], "line_id": line["id"], "fecha": line["fecha"]}
        cursor.execute("""
            SELECT 1 FROM movements m
            JOIN entries e ON e.id = m.entrada_id
            WHERE m.producto_id = %(producto_id)s AND m.tipo = 'entrada'
              AND e.anulada_en IS NULL AND m.id > %(line_id)s
            UNION ALL
            SELECT 1 FROM price_history
            WHERE producto_id = %(producto_id)s AND tipo = 'compra' AND fecha > %(fecha)s
            LIMIT 1
        """, params)
        if cursor.fetchone() is not None:
            return
        cursor.execute("""
            SELECT m.precio FROM movements m
            JOIN entries e ON e.id = m.entrada_id
            WHERE m.producto_id = %(producto_id)s AND m.tipo = 'entrada' AND e.anulada_en IS NULL
            ORDER BY m.id DESC
            LIMIT 1
        """, params)
        previous = cursor.fetchone()
        if previous is not None:
            cursor.execute(
                "UPDATE products SET precio_compra = %(precio)s WHERE id = %(producto_id)s",
                {"precio": previous["precio"], "producto_id": line["producto_id"]},
            )

    def _void_lines(self, cursor, entry_id, lines, usuario_id, motivo):
        """One 'anulacion' per line (same quantity, so the stock goes back), the entry marked as
        voided with who and why, and the purchase price put back. Must run inside a transaction."""
        for line in lines:
            cursor.execute("""
                INSERT INTO movements (tipo, cantidad, precio, motivo, producto_id, usuario_id,
                                       proveedor_id, entrada_id, presentacion_id)
                VALUES ('anulacion', %(cantidad)s, %(precio)s, %(motivo)s, %(producto_id)s,
                        %(usuario_id)s, %(proveedor_id)s, %(entrada_id)s, %(presentacion_id)s)
            """, {
                **line, "motivo": motivo, "usuario_id": usuario_id, "entrada_id": entry_id,
            })
        # factura_vigente becomes NULL by itself, so the invoice number is free again
        cursor.execute("""
            UPDATE entries
            SET anulada_en = NOW(), anulada_por = %(usuario_id)s, motivo_anulacion = %(motivo)s
            WHERE id = %(id)s
        """, {"id": entry_id, "usuario_id": usuario_id, "motivo": motivo})
        for line in lines:
            self._restore_purchase_price(cursor, line)

    def void_entry(self, entry_id, usuario_id, motivo):
        """HU-14: voids an entry. Todo o nada.

        Raises EntryAlreadyVoided, or NegativeStock if part of it was already taken out.
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    lines = self._lock_entry_lines(cursor, entry_id)
                    changes = {}
                    for line in lines:
                        changes[line["producto_id"]] = (
                            changes.get(line["producto_id"], 0) - line["cantidad"]
                        )
                    self._check_stock_change(cursor, changes)
                    self._void_lines(cursor, entry_id, lines, usuario_id, motivo)
                conn.commit()
            except Exception:
                # Also releases the locks
                conn.rollback()
                raise

    def correct_entry(self, entry_id, usuario_id, motivo,
                      proveedor_id, numero_factura, fecha_factura, items):
        """HU-14: voids the entry and saves the corrected one, in one transaction.

        The stock check uses the net result (entered 100 instead of 10 and 5 were taken out:
        95 - 100 + 10 = 5, fine). Returns the new entry id. Raises EntryAlreadyVoided,
        NegativeStock, or pymysql.err.IntegrityError if the invoice number is taken.
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    lines = self._lock_entry_lines(cursor, entry_id)
                    changes = {}
                    for line in lines:
                        changes[line["producto_id"]] = (
                            changes.get(line["producto_id"], 0) - line["cantidad"]
                        )
                    for item in items:
                        changes[item["producto_id"]] = (
                            changes.get(item["producto_id"], 0) + item["cantidad"]
                        )
                    self._check_stock_change(cursor, changes)
                    # Void first: the corrected invoice usually has the same number
                    self._void_lines(cursor, entry_id, lines, usuario_id, motivo)
                    new_id = self._insert_entry(
                        cursor, proveedor_id, numero_factura, fecha_factura, usuario_id, items
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            return new_id

    # ------------------------------------------------------------
    # Outputs (HU-16 merma; HU-17 uso interno later; sales come from billing, see
    # facturacion-conditions.txt). HU-18: never leave the stock below zero
    # ------------------------------------------------------------

    @staticmethod
    def _lock_stock(cursor, producto_id):
        """HU-18: locks the product row until commit and returns its current stock.

        Two people taking the last 5 sacks at the same time: the second one waits here
        and then sees the stock the first one left. Must run inside a transaction.
        Reusable by any outgoing movement (merma, uso interno, ventas).
        """
        cursor.execute("SELECT id FROM products WHERE id = %(id)s FOR UPDATE", {"id": producto_id})
        cursor.execute(f"""
            SELECT COALESCE(SUM({STOCK_CHANGE}), 0) AS existencia
            FROM movements m
            WHERE m.producto_id = %(id)s
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

    # ------------------------------------------------------------
    # HU-20: kárdex. Everything that came in and went out of one product
    # ------------------------------------------------------------

    def get_product_history(self, product_id, desde=None, hasta=None, limit=25, offset=0):
        """Devuelve el historial de un producto, o None si el producto no existe.

        desde / hasta: datetimes; desde inclusive, hasta exclusive (the day after the last one).
        Returns {"producto", "resumen", "total", "movimientos"}: resumen and total count the
        whole date range, movimientos is only the requested page, newest first.
        Each movement carries existencia = stock right after it. It is computed over ALL the
        product's movements before filtering by date, so it is right on every page and range.
        """
        product_query = f"""
            SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.activo, c.nombre AS categoria,
                   COALESCE((SELECT SUM({STOCK_CHANGE})
                             FROM movements m WHERE m.producto_id = p.id), 0) AS existencia
            FROM products p
            LEFT JOIN categories c ON c.id = p.categoria_id
            WHERE p.id = %(id)s
        """
        # The same date condition for the summary and the list. NULL = no limit on that side
        in_range = "(%(desde)s IS NULL OR fecha >= %(desde)s) AND (%(hasta)s IS NULL OR fecha < %(hasta)s)"
        summary_query = f"""
            SELECT COALESCE(SUM(CASE WHEN fecha < %(desde)s THEN cambio END), 0) AS inicio,
                   COALESCE(SUM(CASE WHEN {in_range} AND cambio > 0 THEN cambio END), 0) AS entro,
                   COALESCE(SUM(CASE WHEN {in_range} AND cambio < 0 THEN -cambio END), 0) AS salio,
                   COUNT(CASE WHEN {in_range} THEN 1 END) AS total
            FROM (SELECT m.fecha, {STOCK_CHANGE} AS cambio
                  FROM movements m WHERE m.producto_id = %(id)s) x
        """
        list_query = f"""
            SELECT k.id, k.tipo, k.cantidad, k.cambio, k.existencia, k.precio, k.motivo, k.fecha,
                   k.usuario_id, u.nombre AS usuario,
                   k.proveedor_id, s.nombre AS proveedor,
                   k.entrada_id, e.numero_factura, e.anulada_en IS NOT NULL AS anulada, k.conteo_id,
                   pr.nombre AS presentacion, pr.factor
            FROM (
                SELECT m.*,
                       {STOCK_CHANGE} AS cambio,
                       SUM({STOCK_CHANGE})
                           OVER (ORDER BY m.fecha, m.id) AS existencia
                FROM movements m
                WHERE m.producto_id = %(id)s
            ) k
            JOIN users u ON u.users = k.usuario_id
            LEFT JOIN suppliers s ON s.id = k.proveedor_id
            LEFT JOIN entries e ON e.id = k.entrada_id
            LEFT JOIN presentations pr ON pr.id = k.presentacion_id
            WHERE {in_range.replace('fecha', 'k.fecha')}
            ORDER BY k.fecha DESC, k.id DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """
        params = {"id": product_id, "desde": desde, "hasta": hasta, "limit": limit, "offset": offset}
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(product_query, params)
                product = cursor.fetchone()
                if product is None:
                    return None
                cursor.execute(summary_query, params)
                summary = cursor.fetchone()
                cursor.execute(list_query, params)
                rows = cursor.fetchall()
        total = summary.pop("total")
        summary["final"] = summary["inicio"] + summary["entro"] - summary["salio"]
        return {"producto": product, "resumen": summary, "total": total, "movimientos": rows}

    # ------------------------------------------------------------
    # HU-26: how much money is in the store (stock × purchase price)
    # ------------------------------------------------------------

    def get_stock_with_cost(self):
        """Products that have stock, with their category and purchase price (NULL = unknown).

        Inactive products are included: the merchandise is still on the shelf.
        """
        query = f"""
            SELECT * FROM (
                SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.activo, p.precio_compra,
                       p.categoria_id, c.nombre AS categoria,
                       COALESCE(SUM({STOCK_CHANGE}), 0)
                           AS existencia
                FROM products p
                LEFT JOIN categories c ON c.id = p.categoria_id
                LEFT JOIN movements m ON m.producto_id = p.id
                GROUP BY p.id, c.nombre
            ) s
            WHERE s.existencia > 0
            ORDER BY s.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    # ------------------------------------------------------------
    # HU-32/33/34: physical count. Only one open at a time
    # ------------------------------------------------------------

    COUNT_SELECT = """
        SELECT c.id, c.estado, c.creado_en, c.creado_por AS creado_por_id, u.nombre AS creado_por,
               c.cerrado_en, c.cerrado_por AS cerrado_por_id, uc.nombre AS cerrado_por,
               (SELECT COUNT(*) FROM count_items i WHERE i.conteo_id = c.id) AS productos,
               (SELECT COUNT(*) FROM count_items i WHERE i.conteo_id = c.id AND i.contado IS NOT NULL)
                   AS contados,
               (SELECT COUNT(*) FROM movements mv WHERE mv.conteo_id = c.id) AS ajustes
        FROM counts c
        JOIN users u ON u.users = c.creado_por
        LEFT JOIN users uc ON uc.users = c.cerrado_por
    """

    def get_open_count(self):
        """El conteo abierto, o None si no hay."""
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(self.COUNT_SELECT + "WHERE c.estado = 'abierto'")
                return cursor.fetchone()

    def get_count_by_id(self, count_id):
        """Un conteo (sin sus productos), o None si no existe."""
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(self.COUNT_SELECT + "WHERE c.id = %(id)s", {"id": count_id})
                return cursor.fetchone()

    def get_count_items(self, count_id):
        """Los productos de un conteo, por categoría y nombre. Sin existencia (HU-32: honest count)."""
        query = """
            SELECT i.id, i.producto_id, p.codigo, p.nombre, p.unidad_base, p.activo,
                   p.categoria_id, c.nombre AS categoria,
                   i.contado, i.contado_en, i.contado_por AS contado_por_id, u.nombre AS contado_por
            FROM count_items i
            JOIN products p ON p.id = i.producto_id
            LEFT JOIN categories c ON c.id = p.categoria_id
            LEFT JOIN users u ON u.users = i.contado_por
            WHERE i.conteo_id = %(id)s
            ORDER BY c.nombre, p.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": count_id})
                return cursor.fetchall()

    # Products that go into a count of these categories: the active ones, and the inactive
    # ones that still have stock (they are still on the shelf)
    COUNT_PRODUCTS_WHERE = f"""
        WHERE p.categoria_id IN ({{placeholders}})
          AND (p.activo = true
               OR (SELECT COALESCE(SUM({STOCK_CHANGE}), 0)
                   FROM movements m WHERE m.producto_id = p.id) > 0)
    """

    def count_products_in_categories(self, categoria_ids):
        """Cuántos productos entrarían en un conteo de esas categorías."""
        placeholders = ", ".join(["%s"] * len(categoria_ids))
        query = "SELECT COUNT(*) AS n FROM products p " + \
            self.COUNT_PRODUCTS_WHERE.format(placeholders=placeholders)
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, tuple(categoria_ids))
                return cursor.fetchone()["n"]

    def add_count(self, categoria_ids, usuario_id):
        """Abre un conteo con los productos de esas categorías y devuelve su id.

        Lanza CountAlreadyOpen si ya hay uno abierto (the UNIQUE on conteo_abierto decides,
        so two people starting one at the same time cannot both succeed).
        """
        placeholders = ", ".join(["%s"] * len(categoria_ids))
        items_query = "INSERT INTO count_items (conteo_id, producto_id) SELECT %s, p.id FROM products p " + \
            self.COUNT_PRODUCTS_WHERE.format(placeholders=placeholders)
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("INSERT INTO counts (creado_por) VALUES (%(usuario_id)s)",
                                   {"usuario_id": usuario_id})
                    count_id = cursor.lastrowid
                    cursor.execute(items_query, (count_id, *categoria_ids))
                conn.commit()
            except pymysql.err.IntegrityError as error:
                conn.rollback()
                if "uq_counts_abierto" in str(error):
                    raise CountAlreadyOpen() from error
                raise
            except Exception:
                conn.rollback()
                raise
            return count_id

    def cancel_count(self, count_id, usuario_id):
        """Cancela un conteo abierto. True si se canceló, False si no estaba abierto."""
        query = """
            UPDATE counts SET estado = 'cancelado', cerrado_por = %(usuario_id)s, cerrado_en = NOW()
            WHERE id = %(id)s AND estado = 'abierto'
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                changed = cursor.execute(query, {"id": count_id, "usuario_id": usuario_id})
            conn.commit()
            return changed == 1

    def save_count_items(self, count_id, items, usuario_id):
        """HU-33: guarda lo contado de una hoja. items: {producto_id: contado or None}.

        Only rows whose value actually changes are written, so saving the same sheet again
        does not change who counted it. Raises CountNotOpen if the count is no longer open
        (the count row is locked, so it cannot be applied or cancelled meanwhile).
        Returns how many products changed.
        """
        query = """
            UPDATE count_items
            SET contado = %(contado)s, contado_por = %(usuario_id)s, contado_en = NOW()
            WHERE conteo_id = %(conteo_id)s AND producto_id = %(producto_id)s
              AND NOT (contado <=> %(contado)s)
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT estado FROM counts WHERE id = %(id)s FOR UPDATE",
                                   {"id": count_id})
                    row = cursor.fetchone()
                    if row is None or row["estado"] != "abierto":
                        raise CountNotOpen()
                    changed = 0
                    for producto_id, contado in items.items():
                        changed += cursor.execute(query, {
                            "conteo_id": count_id, "producto_id": producto_id,
                            "contado": contado, "usuario_id": usuario_id,
                        })
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            return changed

    def get_count_compare(self, count_id):
        """HU-33 (owner only): the products of a count with the system's stock right now
        and the purchase price, so Flask can compute diferencia and dinero."""
        query = f"""
            SELECT i.id, i.producto_id, p.codigo, p.nombre, p.unidad_base, p.activo,
                   p.categoria_id, c.nombre AS categoria, p.precio_compra,
                   i.contado, i.contado_en, i.contado_por AS contado_por_id, u.nombre AS contado_por,
                   COALESCE((SELECT SUM({STOCK_CHANGE}) FROM movements m
                             WHERE m.producto_id = p.id), 0) AS existencia
            FROM count_items i
            JOIN products p ON p.id = i.producto_id
            LEFT JOIN categories c ON c.id = p.categoria_id
            LEFT JOIN users u ON u.users = i.contado_por
            WHERE i.conteo_id = %(id)s
            ORDER BY c.nombre, p.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": count_id})
                return cursor.fetchall()

    def get_counts(self, limit=50):
        """HU-34: los últimos conteos (abiertos, aplicados y cancelados), el más reciente primero."""
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(self.COUNT_SELECT + "ORDER BY c.id DESC LIMIT %(limit)s", {"limit": limit})
                return cursor.fetchall()

    def get_count_adjustments(self, count_id):
        """HU-34: the movements a count applied, by producto_id."""
        query = """
            SELECT m.producto_id, m.tipo, m.cantidad, m.precio, m.motivo
            FROM movements m
            WHERE m.conteo_id = %(id)s
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": count_id})
                return {row["producto_id"]: row for row in cursor.fetchall()}

    def apply_count(self, count_id, ajustes, usuario_id):
        """HU-34: aplica los ajustes que el dueño aprobó y cierra el conteo como 'aplicado'.

        ajustes: {producto_id: {"motivo": str, "diferencia": Decimal}} where diferencia is
        what the owner saw (contado − existencia). Products left out keep the system's stock.
        Inside one transaction: locks the count (CountNotOpen), then each product in id order
        (_lock_stock), recomputes contado − existencia and raises CountChanged if any differs
        from what was approved. Each adjustment is one ajuste_mas / ajuste_menos movement with
        the purchase price of the moment, so afterwards the stock equals what was counted
        (never negative, because contado >= 0). Returns how many movements were written.
        """
        insert = """
            INSERT INTO movements (tipo, cantidad, precio, motivo, producto_id, usuario_id, conteo_id)
            VALUES (%(tipo)s, %(cantidad)s, %(precio)s, %(motivo)s, %(producto_id)s,
                    %(usuario_id)s, %(conteo_id)s)
        """
        item_query = """
            SELECT i.contado, p.codigo, p.nombre, p.unidad_base
            FROM count_items i JOIN products p ON p.id = i.producto_id
            WHERE i.conteo_id = %(conteo_id)s AND i.producto_id = %(producto_id)s
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT estado FROM counts WHERE id = %(id)s FOR UPDATE",
                                   {"id": count_id})
                    row = cursor.fetchone()
                    if row is None or row["estado"] != "abierto":
                        raise CountNotOpen()

                    changed, pending = [], []
                    for producto_id in sorted(ajustes):
                        existencia = self._lock_stock(cursor, producto_id)
                        cursor.execute(item_query, {"conteo_id": count_id, "producto_id": producto_id})
                        item = cursor.fetchone()
                        aprobada = ajustes[producto_id]["diferencia"]
                        diferencia = item["contado"] - existencia if item["contado"] is not None else None
                        if diferencia != aprobada:
                            changed.append({
                                "producto_id": producto_id, "codigo": item["codigo"],
                                "nombre": item["nombre"], "unidad_base": item["unidad_base"],
                                "existencia": existencia, "contado": item["contado"],
                                "diferencia": diferencia, "aprobada": aprobada,
                            })
                        elif diferencia != 0:
                            pending.append((producto_id, diferencia))
                    if changed:
                        raise CountChanged(changed)

                    for producto_id, diferencia in pending:
                        cursor.execute(insert, {
                            "tipo": "ajuste_mas" if diferencia > 0 else "ajuste_menos",
                            "cantidad": abs(diferencia),
                            "precio": self._last_purchase_price(cursor, producto_id),
                            "motivo": ajustes[producto_id]["motivo"],
                            "producto_id": producto_id, "usuario_id": usuario_id,
                            "conteo_id": count_id,
                        })
                    cursor.execute("""
                        UPDATE counts SET estado = 'aplicado', cerrado_por = %(usuario_id)s,
                                          cerrado_en = NOW()
                        WHERE id = %(id)s
                    """, {"id": count_id, "usuario_id": usuario_id})
                conn.commit()
            except Exception:
                # Also releases the locks
                conn.rollback()
                raise
            return len(pending)

    # ------------------------------------------------------------
    # HU-31: load what the store already has (from Excel)
    # ------------------------------------------------------------

    def get_products_for_initial_load(self):
        """Every product with its purchase price and whether it already has movements."""
        query = """
            SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.precio_compra, p.activo,
                   c.nombre AS categoria,
                   EXISTS (SELECT 1 FROM movements m WHERE m.producto_id = p.id) AS tiene_movimientos
            FROM products p
            LEFT JOIN categories c ON c.id = p.categoria_id
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def initial_load(self, nuevos, existentes, usuario_id, motivo):
        """Saves a checked Excel file in one transaction: all or nothing (HU-31).

        nuevos: dicts with the fields of add_product (codigo, nombre, precio, precio_compra,
        unidad_base, stock_minimo, categoria_id, existencia).
        existentes: dicts with producto_id, codigo, existencia and precio_compra (None = keep).
        Raises ProductHasMovements if an existing product got a movement since it was checked
        (it is locked first), and pymysql IntegrityError if a new codigo was taken meanwhile.
        """
        with self._connection() as conn:
            try:
                with conn.cursor() as cursor:
                    taken = []
                    for row in sorted(existentes, key=lambda r: r["producto_id"]):
                        cursor.execute("SELECT id FROM products WHERE id = %(id)s FOR UPDATE",
                                       {"id": row["producto_id"]})
                        cursor.execute("SELECT 1 FROM movements WHERE producto_id = %(id)s LIMIT 1",
                                       {"id": row["producto_id"]})
                        if cursor.fetchone():
                            taken.append(row["codigo"])
                    if taken:
                        raise ProductHasMovements(taken)

                    for row in existentes:
                        if row["precio_compra"] is not None:
                            cursor.execute(
                                "UPDATE products SET precio_compra = %(precio)s WHERE id = %(id)s",
                                {"precio": row["precio_compra"], "id": row["producto_id"]})
                        if row["existencia"]:
                            cursor.execute("SELECT precio_compra FROM products WHERE id = %(id)s",
                                           {"id": row["producto_id"]})
                            precio = cursor.fetchone()["precio_compra"]
                            self._insert_initial_stock(cursor, row["producto_id"], row["existencia"],
                                                       precio, usuario_id, motivo)

                    for row in nuevos:
                        cursor.execute(self.PRODUCT_INSERT, row)
                        if row["existencia"]:
                            self._insert_initial_stock(cursor, cursor.lastrowid, row["existencia"],
                                                       row["precio_compra"], usuario_id, motivo)
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    # ------------------------------------------------------------
    # HU-10: what each supplier brings and at what price
    # ------------------------------------------------------------

    # One row per (product, supplier) pair with its LAST purchase (n = 1) and the one before
    # (prev, n = 2). Only valid invoices: a voided one's price no longer counts. The order is
    # the invoice date, then the entry id (two invoices on the same day: the later one wins).
    PURCHASES_QUERY = """
        WITH compras AS (
            SELECT m.producto_id, m.proveedor_id, m.precio, m.cantidad, m.presentacion_id,
                   e.id AS entrada_id, e.numero_factura, e.fecha_factura,
                   ROW_NUMBER() OVER (PARTITION BY m.producto_id, m.proveedor_id
                                      ORDER BY e.fecha_factura DESC, e.id DESC, m.id DESC) AS n,
                   COUNT(*) OVER (PARTITION BY m.producto_id, m.proveedor_id) AS veces,
                   SUM(m.cantidad) OVER (PARTITION BY m.producto_id, m.proveedor_id) AS total
            FROM movements m
            JOIN entries e ON e.id = m.entrada_id
            WHERE m.tipo = 'entrada' AND e.anulada_en IS NULL AND {where}
        )
        SELECT u.producto_id, p.codigo, p.nombre, p.unidad_base, p.activo, c.nombre AS categoria,
               u.proveedor_id, s.nombre AS proveedor, s.activo AS proveedor_activo, s.telefono,
               u.precio, pr.nombre AS presentacion, pr.factor,
               u.entrada_id, u.numero_factura, u.fecha_factura, u.veces, u.total,
               prev.precio AS precio_anterior, prev.fecha_factura AS fecha_anterior
        FROM compras u
        LEFT JOIN compras prev
               ON prev.producto_id = u.producto_id AND prev.proveedor_id = u.proveedor_id AND prev.n = 2
        JOIN products p ON p.id = u.producto_id
        LEFT JOIN categories c ON c.id = p.categoria_id
        JOIN suppliers s ON s.id = u.proveedor_id
        LEFT JOIN presentations pr ON pr.id = u.presentacion_id
        WHERE u.n = 1
        ORDER BY {order}
    """

    def get_supplier_products(self, supplier_id):
        """HU-10: the products a supplier has brought, with the last price. Newest purchase first."""
        query = self.PURCHASES_QUERY.format(where="m.proveedor_id = %(id)s",
                                            order="u.fecha_factura DESC, p.nombre")
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": supplier_id})
                return cursor.fetchall()

    def get_product_suppliers(self, product_id):
        """HU-10: the suppliers that have brought a product, with their last price. Cheapest first."""
        query = self.PURCHASES_QUERY.format(where="m.producto_id = %(id)s",
                                            order="u.precio, u.fecha_factura DESC")
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": product_id})
                return cursor.fetchall()

    def get_purchase_order(self):
        """HU-23: the low-stock products (same rule as HU-22) with the supplier of their LAST
        valid invoice (any supplier; voided invoices do not count), its price per base unit and
        the presentation it came in. Products never bought have NULL supplier and price.
        Grouped by supplier name (no supplier last), then product name.
        """
        query = f"""
            WITH bajos AS (
                SELECT * FROM (
                    SELECT p.id, p.codigo, p.nombre, p.unidad_base, p.stock_minimo,
                           p.precio_compra, c.nombre AS categoria,
                           COALESCE(SUM({STOCK_CHANGE}), 0) AS existencia
                    FROM products p
                    LEFT JOIN categories c ON c.id = p.categoria_id
                    LEFT JOIN movements m ON m.producto_id = p.id
                    WHERE p.activo = true AND p.stock_minimo IS NOT NULL
                    GROUP BY p.id, c.nombre
                ) s
                WHERE s.existencia <= s.stock_minimo
            ),
            ultima AS (
                SELECT m.producto_id, m.proveedor_id, m.precio, m.presentacion_id, e.fecha_factura,
                       ROW_NUMBER() OVER (PARTITION BY m.producto_id
                                          ORDER BY e.fecha_factura DESC, e.id DESC, m.id DESC) AS n
                FROM movements m
                JOIN entries e ON e.id = m.entrada_id
                WHERE m.tipo = 'entrada' AND e.anulada_en IS NULL
                  AND m.producto_id IN (SELECT id FROM bajos)
            )
            SELECT b.id AS producto_id, b.codigo, b.nombre, b.unidad_base, b.stock_minimo,
                   b.existencia, b.categoria, b.precio_compra,
                   u.proveedor_id, s.nombre AS proveedor, s.contacto, s.telefono,
                   s.activo AS proveedor_activo,
                   u.precio, u.fecha_factura, pr.nombre AS presentacion, pr.factor
            FROM bajos b
            LEFT JOIN ultima u ON u.producto_id = b.id AND u.n = 1
            LEFT JOIN suppliers s ON s.id = u.proveedor_id
            LEFT JOIN presentations pr ON pr.id = u.presentacion_id
            ORDER BY s.nombre IS NULL, s.nombre, u.proveedor_id, b.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cursor.fetchall()

    def get_supplier_invoice_summary(self, supplier_id):
        """HU-10: how many valid invoices a supplier has and the date of the last one."""
        query = """
            SELECT COUNT(*) AS facturas, MAX(fecha_factura) AS ultima_compra
            FROM entries
            WHERE proveedor_id = %(id)s AND anulada_en IS NULL
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, {"id": supplier_id})
                return cursor.fetchone()

    # ------------------------------------------------------------
    # HU-27: every movement, filtered by date, type and user
    # ------------------------------------------------------------

    MOVEMENT_TYPES = ("entrada", "venta", "dano", "uso", "anulacion", "ajuste_mas", "ajuste_menos",
                      "inicial")

    @staticmethod
    def _movement_filters(desde, hasta, tipo, usuario_id, skip=()):
        """WHERE for the movements report. skip leaves out one filter, so the summary per type
        ignores the type filter (and the one per user the user filter): the owner can see the
        other options with their numbers and click them."""
        conditions = ["(%(desde)s IS NULL OR m.fecha >= %(desde)s)",
                      "(%(hasta)s IS NULL OR m.fecha < %(hasta)s)"]
        if tipo and "tipo" not in skip:
            conditions.append("m.tipo = %(tipo)s")
        if usuario_id and "usuario" not in skip:
            conditions.append("m.usuario_id = %(usuario_id)s")
        return "WHERE " + " AND ".join(conditions)

    def get_movements(self, desde=None, hasta=None, tipo=None, usuario_id=None, limit=25, offset=0):
        """HU-27: one page of movements (newest first) plus the totals of the whole range.

        desde inclusive, hasta exclusive (datetimes). Returns {"total", "movimientos",
        "por_tipo": [{tipo, movimientos, dinero}], "por_usuario": [{usuario_id, usuario, movimientos}]}.
        dinero = SUM(cantidad × precio): quantities are not added up because lb, m and units mix.
        """
        params = {"desde": desde, "hasta": hasta, "tipo": tipo, "usuario_id": usuario_id,
                  "limit": limit, "offset": offset}
        where = self._movement_filters(desde, hasta, tipo, usuario_id)
        list_query = f"""
            SELECT m.id, m.tipo, m.cantidad, {STOCK_CHANGE} AS cambio, m.precio, m.motivo, m.fecha,
                   m.producto_id, p.codigo, p.nombre AS producto, p.unidad_base,
                   m.usuario_id, u.nombre AS usuario,
                   m.proveedor_id, s.nombre AS proveedor,
                   m.entrada_id, e.numero_factura, e.anulada_en IS NOT NULL AS anulada, m.conteo_id,
                   pr.nombre AS presentacion, pr.factor
            FROM movements m
            JOIN products p ON p.id = m.producto_id
            JOIN users u ON u.users = m.usuario_id
            LEFT JOIN suppliers s ON s.id = m.proveedor_id
            LEFT JOIN entries e ON e.id = m.entrada_id
            LEFT JOIN presentations pr ON pr.id = m.presentacion_id
            {where}
            ORDER BY m.fecha DESC, m.id DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """
        count_query = f"SELECT COUNT(*) AS total FROM movements m {where}"
        type_query = f"""
            SELECT m.tipo, COUNT(*) AS movimientos, SUM(m.cantidad * m.precio) AS dinero
            FROM movements m
            {self._movement_filters(desde, hasta, tipo, usuario_id, skip=("tipo",))}
            GROUP BY m.tipo
        """
        user_query = f"""
            SELECT m.usuario_id, u.nombre AS usuario, COUNT(*) AS movimientos
            FROM movements m
            JOIN users u ON u.users = m.usuario_id
            {self._movement_filters(desde, hasta, tipo, usuario_id, skip=("usuario",))}
            GROUP BY m.usuario_id, u.nombre
            ORDER BY movimientos DESC, u.nombre
        """
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(list_query, params)
                rows = cursor.fetchall()
                cursor.execute(count_query, params)
                total = cursor.fetchone()["total"]
                cursor.execute(type_query, params)
                por_tipo = cursor.fetchall()
                cursor.execute(user_query, params)
                por_usuario = cursor.fetchall()
        return {"total": total, "movimientos": rows, "por_tipo": por_tipo, "por_usuario": por_usuario}
