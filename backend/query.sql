create table users(
	users int AUTO_INCREMENT not null,
	nombre varchar(100) not null,
	rol enum('admin', 'employee') not null,
	email varchar(50) not null unique,
	password_hash varchar(100) not null,
	PRIMARY KEY(users)
);
