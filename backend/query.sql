create table users(
	users int AUTO_INCREMENT not null,
	nombre varchar(100) not null,
	rol enum('admin', 'employee') not null,
	email varchar(50) not null unique,
	password_hash varchar(100) not null,
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
