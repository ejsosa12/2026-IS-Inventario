create table users(
	users int AUTO_INCREMENT not null,
	nombre varchar(100) not null,
	rol enum('admin', 'employee') not null,
	email varchar(50) not null unique,
	password_hash varchar(100) not null,
	activo boolean not null default true,
	PRIMARY KEY(users)
);

INSERT INTO users (
nombre, rol, email, password_hash
) VALUES ( "Don Rigo", 
						"admin", 
						"don_rigo23@elclavo.com", 
						"5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5" 
					);

INSERT INTO users ( nombre, rol, email, password_hash
) VALUES ( "José Sosa", 
						"admin", 
						"jose.sosa@elclavo.com", 
						"5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5" 
					);

INSERT INTO users (
nombre, rol, email, password_hash
) VALUES ( "David Jimenes",
						"employee",
						"david.jimenes@elclavo.com",
						"5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"
					);

INSERT INTO users (
nombre, rol, email, password_hash
) VALUES ( "Kevin Pinones",
						"employee",
						"kevin.pinones@elclavo.com",
						"5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"
					);

-- ============================================================
-- Modelo de datos (C4 nivel 4)
-- Orden: primero las tablas que no dependen de nadie,
-- después las que tienen llaves foráneas.
-- ============================================================

-- HU-05: ordenar los productos por categoría
create table categories(
	id int AUTO_INCREMENT not null,
	nombre varchar(50) not null unique,
	-- HU-05: el dueño la desactiva sin borrarla; sus productos la conservan
	activo boolean not null default true,
	PRIMARY KEY(id)
);

-- HU-09: registrar a los proveedores
create table suppliers(
	id int AUTO_INCREMENT not null,
	nombre varchar(100) not null,
	telefono varchar(20),
	-- Nombre del vendedor o contacto (opcional)
	contacto varchar(100),
	-- Opcional. Si se pone, no puede repetirse (varios NULL sí se permiten)
	nit varchar(20),
	-- Desactivar sin borrar: sus entradas viejas lo siguen usando
	activo boolean not null default true,
	PRIMARY KEY(id),
	UNIQUE(nit)
);

-- HU-01, HU-02, HU-04, HU-21
-- La existencia NO se guarda aquí: se calcula sumando los movimientos
create table products(
	id int AUTO_INCREMENT not null,
	codigo varchar(30) not null unique,
	nombre varchar(100) not null,
	-- Precio de venta por unidad base
	precio decimal(10,2) not null check (precio >= 0),
	-- HU-02: precio de compra por unidad base (4 decimales como en movements).
	-- Cada factura (HU-11) lo actualiza sola y el dueño lo puede corregir.
	-- NULL = todavía no se ha comprado
	precio_compra decimal(12,4) check (precio_compra >= 0),
	-- HU-07: 'lb', 'm' y 'gal' aceptan decimales, 'unidad' solo enteros
	unidad_base enum('unidad', 'lb', 'm', 'gal') not null default 'unidad',
	-- HU-21: NULL = el producto no genera alertas
	stock_minimo decimal(10,3) check (stock_minimo >= 0),
	-- HU-04: dar de baja sin borrar el historial
	activo boolean not null default true,
	-- HU-05: cada producto pertenece a una categoría
	categoria_id int not null,
	PRIMARY KEY(id),
	FOREIGN KEY(categoria_id) REFERENCES categories(id)
);

-- HU-06 y HU-08: cómo se compra el producto (1 caja = 50 lb)
create table presentations(
	id int AUTO_INCREMENT not null,
	producto_id int not null,
	nombre varchar(30) not null,
	-- Cuántas unidades base trae (ej. 50 lb por caja)
	factor decimal(10,3) not null check (factor > 0),
	PRIMARY KEY(id),
	-- Un producto no puede tener dos presentaciones con el mismo nombre
	UNIQUE(producto_id, nombre),
	FOREIGN KEY(producto_id) REFERENCES products(id)
);

-- HU-02: quién cambió un precio, cuándo y cuál era el anterior.
-- Solo los cambios hechos por el dueño en "Editar producto"; las facturas
-- ya son su propio registro del precio de compra
create table price_history(
	id int AUTO_INCREMENT not null,
	producto_id int not null,
	-- Cuál de los dos precios cambió
	tipo enum('venta', 'compra') not null,
	-- NULL si antes no tenía (precio de compra de un producto sin compras)
	precio_anterior decimal(12,4),
	precio_nuevo decimal(12,4) not null,
	usuario_id int not null,
	fecha datetime not null default current_timestamp,
	PRIMARY KEY(id),
	FOREIGN KEY(producto_id) REFERENCES products(id),
	FOREIGN KEY(usuario_id) REFERENCES users(users)
);

-- HU-11: encabezado de una factura de compra (los productos van en movements)
create table entries(
	id int AUTO_INCREMENT not null,
	proveedor_id int not null,
	numero_factura varchar(30) not null,
	-- Fecha impresa en la factura (puede ser de ayer)
	fecha_factura date not null,
	-- Cuándo se registró en el sistema y quién (HU-11)
	fecha datetime not null default current_timestamp,
	usuario_id int not null,
	-- HU-14: una entrada equivocada no se borra, se anula: cuándo, quién y por qué
	anulada_en datetime,
	anulada_por int,
	motivo_anulacion varchar(200),
	-- La calcula la base: el número mientras la entrada sirve, NULL si está anulada.
	-- MariaDB no tiene UNIQUE con WHERE; así una factura anulada se puede ingresar de nuevo
	factura_vigente varchar(30) as (if(anulada_en is null, numero_factura, null)) persistent,
	PRIMARY KEY(id),
	-- La misma factura del mismo proveedor no se ingresa dos veces (mientras no esté anulada)
	CONSTRAINT uq_entries_factura_vigente UNIQUE(proveedor_id, factura_vigente),
	-- Una entrada anulada siempre dice quién y por qué
	CONSTRAINT chk_entries_anulada CHECK (
		anulada_en IS NULL
		OR (anulada_por IS NOT NULL AND motivo_anulacion IS NOT NULL AND motivo_anulacion <> '')
	),
	FOREIGN KEY(proveedor_id) REFERENCES suppliers(id),
	FOREIGN KEY(usuario_id) REFERENCES users(users),
	CONSTRAINT fk_entries_anulada_por FOREIGN KEY(anulada_por) REFERENCES users(users)
);

-- HU-32/33/34: un conteo físico. Solo uno abierto a la vez
create table counts(
	id int AUTO_INCREMENT not null,
	estado enum('abierto', 'aplicado', 'cancelado') not null default 'abierto',
	creado_por int not null,
	creado_en datetime not null default current_timestamp,
	-- Quién lo aplicó (HU-34) o lo canceló, y cuándo
	cerrado_por int,
	cerrado_en datetime,
	-- 1 mientras está abierto, NULL después: el UNIQUE deja un solo conteo abierto
	conteo_abierto tinyint as (if(estado = 'abierto', 1, null)) persistent,
	PRIMARY KEY(id),
	CONSTRAINT uq_counts_abierto UNIQUE(conteo_abierto),
	CONSTRAINT chk_counts_cerrado CHECK (estado = 'abierto' OR (cerrado_por IS NOT NULL AND cerrado_en IS NOT NULL)),
	FOREIGN KEY(creado_por) REFERENCES users(users),
	FOREIGN KEY(cerrado_por) REFERENCES users(users)
);

-- Los productos que entran en el conteo y lo que se contó de cada uno (HU-33)
create table count_items(
	id int AUTO_INCREMENT not null,
	conteo_id int not null,
	producto_id int not null,
	-- NULL = todavía no se ha contado. En unidad base
	contado decimal(10,3) check (contado >= 0),
	contado_por int,
	contado_en datetime,
	PRIMARY KEY(id),
	UNIQUE(conteo_id, producto_id),
	FOREIGN KEY(conteo_id) REFERENCES counts(id),
	FOREIGN KEY(producto_id) REFERENCES products(id),
	FOREIGN KEY(contado_por) REFERENCES users(users)
);

-- HU-11, HU-12, HU-15, HU-16, HU-17, HU-28
-- Todo cambio de existencia pasa por aquí
create table movements(
	id int AUTO_INCREMENT not null,
	-- HU-14: 'anulacion' resta lo que sumó una entrada anulada (no se borra nada)
	-- HU-34: 'ajuste_mas' suma y 'ajuste_menos' resta lo que no cuadró en un conteo físico
	tipo enum('entrada', 'venta', 'dano', 'uso', 'anulacion', 'ajuste_mas', 'ajuste_menos') not null,
	-- Siempre en unidad base y siempre positiva: el tipo dice si suma o resta.
	-- En una entrada es lo que llegó de verdad (HU-12)
	cantidad decimal(10,3) not null check (cantidad > 0),
	-- HU-12: lo que dice la factura, en unidad base. Si no coincide con
	-- cantidad, la entrada sale en "entradas con faltantes". NULL fuera de entradas
	cantidad_factura decimal(10,3) check (cantidad_factura >= 0),
	-- Precio por unidad base en ese momento. En entradas, lo que se pagó.
	-- En daño y uso interno, el último precio de compra (para saber cuánto se perdió)
	-- 4 decimales: Q100 el rollo de 30 m = Q3.3333 por metro
	precio decimal(12,4) check (precio >= 0),
	-- HU-16 y HU-17: por qué salió (se rompió, para qué se usó). HU-14: por qué se anuló.
	-- NULL en entradas y ventas
	motivo varchar(200),
	fecha datetime not null default current_timestamp,
	producto_id int not null,
	usuario_id int not null,
	-- Solo las entradas tienen proveedor
	proveedor_id int,
	-- HU-11: factura a la que pertenece (también en su anulación, HU-14). NULL en el resto
	entrada_id int,
	-- HU-06: en qué presentación llegó (caja, rollo). NULL = en unidad base
	presentacion_id int,
	-- HU-34: conteo del que salió el ajuste. NULL en el resto
	conteo_id int,
	PRIMARY KEY(id),
	-- Daño, uso interno, anulación y ajustes siempre llevan motivo
	CONSTRAINT chk_movements_motivo
		CHECK (tipo NOT IN ('dano', 'uso', 'anulacion', 'ajuste_mas', 'ajuste_menos')
		       OR (motivo IS NOT NULL AND motivo <> '')),
	FOREIGN KEY(producto_id) REFERENCES products(id),
	FOREIGN KEY(usuario_id) REFERENCES users(users),
	FOREIGN KEY(proveedor_id) REFERENCES suppliers(id),
	FOREIGN KEY(entrada_id) REFERENCES entries(id),
	FOREIGN KEY(presentacion_id) REFERENCES presentations(id),
	FOREIGN KEY(conteo_id) REFERENCES counts(id)
);

-- ============================================================
-- Datos de ejemplo: categorías, productos y presentaciones
-- Se usan subconsultas en vez de ids fijos para no depender
-- del orden en que se insertaron.
-- ============================================================

INSERT INTO categories (nombre) VALUES
	('Clavos y tornillos'),
	('Plomería'),
	('Construcción'),
	('Herramientas'),
	('Electricidad');

INSERT INTO products (codigo, nombre, precio, unidad_base, stock_minimo, activo, categoria_id) VALUES
	-- Por libra (HU-06): se compran en caja
	('CLA-003', 'Clavo de 3 pulgadas', 8.50, 'lb', 20, true, (SELECT id FROM categories WHERE nombre = 'Clavos y tornillos')),
	('CLA-002', 'Clavo de 2 pulgadas', 9.00, 'lb', 15, true, (SELECT id FROM categories WHERE nombre = 'Clavos y tornillos')),
	-- Por metro (HU-07): se compran en rollo
	('MAN-050', 'Manguera de jardín 1/2"', 6.00, 'm', 30, true, (SELECT id FROM categories WHERE nombre = 'Plomería')),
	('CAB-012', 'Cable eléctrico calibre 12', 4.50, 'm', 50, true, (SELECT id FROM categories WHERE nombre = 'Electricidad')),
	-- Por unidad
	('CEM-042', 'Cemento gris 42.5 kg', 85.00, 'unidad', 20, true, (SELECT id FROM categories WHERE nombre = 'Construcción')),
	('TUB-PVC', 'Tubo PVC 1/2" x 6 m', 22.00, 'unidad', 10, true, (SELECT id FROM categories WHERE nombre = 'Plomería')),
	('TOR-158', 'Tornillo para madera 1 5/8"', 0.35, 'unidad', 100, true, (SELECT id FROM categories WHERE nombre = 'Clavos y tornillos')),
	-- Sin stock mínimo: no genera alertas (HU-21)
	('MAR-016', 'Martillo de uña 16 oz', 65.00, 'unidad', NULL, true, (SELECT id FROM categories WHERE nombre = 'Herramientas')),
	-- Dado de baja (HU-04): no debe salir en búsquedas
	('BRO-OLD', 'Juego de brocas (descontinuado)', 120.00, 'unidad', NULL, false, (SELECT id FROM categories WHERE nombre = 'Herramientas'));

INSERT INTO presentations (producto_id, nombre, factor) VALUES
	((SELECT id FROM products WHERE codigo = 'CLA-003'), 'caja', 50),
	((SELECT id FROM products WHERE codigo = 'CLA-002'), 'caja', 50),
	-- Un producto puede tener varias presentaciones
	((SELECT id FROM products WHERE codigo = 'CLA-002'), 'bolsa', 5),
	((SELECT id FROM products WHERE codigo = 'MAN-050'), 'rollo', 30),
	((SELECT id FROM products WHERE codigo = 'CAB-012'), 'rollo', 100),
	((SELECT id FROM products WHERE codigo = 'TOR-158'), 'caja', 100);

-- ============================================================
-- Datos de ejemplo: proveedores (HU-09)
-- Nombres, teléfonos y NIT inventados
-- ============================================================

INSERT INTO suppliers (nombre, telefono, nit) VALUES
	('Distribuidora Ferretera del Norte', '2234-5678', '4521873-6'),
	('Clavos y Alambres La Fragua', '2456-7890', '1098345-2'),
	('Plomería y Riego San Miguel', '5512-3344', '7734120-9'),
	('Cementos y Agregados El Volcán', '7765-4321', '3365091-K'),
	('Eléctrica Industrial Centro', '2298-1100', '8812457-4'),
	-- Sin teléfono ni NIT: los dos son opcionales (HU-09)
	('Herramientas Don Chepe', NULL, NULL);
