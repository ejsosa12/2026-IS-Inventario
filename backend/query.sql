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

-- ============================================================
-- Modelo de datos (C4 nivel 4)
-- Orden: primero las tablas que no dependen de nadie,
-- después las que tienen llaves foráneas.
-- ============================================================

-- HU-05: ordenar los productos por categoría
create table categories(
	id int AUTO_INCREMENT not null,
	nombre varchar(50) not null unique,
	PRIMARY KEY(id)
);

-- HU-09: registrar a los proveedores
create table suppliers(
	id int AUTO_INCREMENT not null,
	nombre varchar(100) not null,
	telefono varchar(20),
	PRIMARY KEY(id)
);

-- HU-01, HU-02, HU-04, HU-21
-- La existencia NO se guarda aquí: se calcula sumando los movimientos
create table products(
	id int AUTO_INCREMENT not null,
	codigo varchar(30) not null unique,
	nombre varchar(100) not null,
	precio decimal(10,2) not null check (precio >= 0),
	-- HU-07: 'lb' y 'm' aceptan decimales, 'unidad' solo enteros
	unidad_base enum('unidad', 'lb', 'm') not null default 'unidad',
	-- HU-21: NULL = el producto no genera alertas
	stock_minimo decimal(10,3) check (stock_minimo >= 0),
	-- HU-04: dar de baja sin borrar el historial
	activo boolean not null default true,
	categoria_id int,
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

-- HU-11, HU-15, HU-16, HU-17, HU-28
-- Todo cambio de existencia pasa por aquí
create table movements(
	id int AUTO_INCREMENT not null,
	tipo enum('entrada', 'venta', 'dano', 'uso') not null,
	-- Siempre en unidad base y siempre positiva: el tipo dice si suma o resta
	cantidad decimal(10,3) not null check (cantidad > 0),
	-- Precio por unidad base en ese momento. NULL en daño y uso interno
	precio decimal(10,2) check (precio >= 0),
	fecha datetime not null default current_timestamp,
	producto_id int not null,
	usuario_id int not null,
	-- Solo las entradas tienen proveedor
	proveedor_id int,
	PRIMARY KEY(id),
	FOREIGN KEY(producto_id) REFERENCES products(id),
	FOREIGN KEY(usuario_id) REFERENCES users(users),
	FOREIGN KEY(proveedor_id) REFERENCES suppliers(id)
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
