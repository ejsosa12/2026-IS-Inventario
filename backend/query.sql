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
