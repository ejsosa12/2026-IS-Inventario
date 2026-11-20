# Modulo de Inventario - IS 2026

Módulo de inventario, hecho como proyecto para el registro de muebles de una compañia. En este caso inspirado para una ferreteria
## Tecnologías

```
Navegador ──► Angular 22 (nginx) ──/api/──► Flask 3 (gunicorn) ──► MariaDB 11.8
```

- **Frontend:** Angular 22 (componentes standalone y signals), Tailwind CSS.
- **Backend:** Python 3.13, Flask 3, PyMySQL, JWT (PyJWT), openpyxl para el Excel, gunicorn.
- **Base de datos:** MariaDB 11.8.
- **Contenedores:** Docker Compose (`db`, `backend`, `frontend`).

## Estructura

```
backend/                 API en Flask
  app/                   un blueprint por área (catalog, movements, sales, counts, users…)
  app/access_data/       la única capa con SQL
  query.sql              esquema completo de la base de datos + datos de ejemplo
frontend/inventory-display/   aplicación Angular
docker/db/init/          los .sql que se cargan la primera vez que arranca la base
docker-compose.yml       entorno local con Docker
deploy/                  docker compose y nginx del servidor de producción
```

## Requisitos

Para correrlo con Docker (recomendado):
- **Docker Engine** con **Docker Compose v2** (el comando `docker compose`), o Docker Desktop.
- **Git**.
- Los puertos **4200** (la aplicación) y **3307** (la base de datos) libres.
- Unos 2 GB de espacio para las imágenes.

No hace falta instalar Python, Node ni MariaDB: todo corre dentro de los contenedores.

## Usarlo con Docker en tu computadora

**1. Clonar el repositorio**
```bash
git clone <url-del-repositorio>
cd 2026-IS-Inventario
```

**2. Crear el archivo `.env`** con las contraseñas del entorno local (no se sube al repositorio):
```bash
cp .env.example .env
```
Ábrelo y cambia los valores `change-me` por los que quieras. `JWT_EXPIRES_IN` son las horas que dura la sesión.

**3. Preparar la base de datos.** Todo `.sql` de `docker/db/init/` se ejecuta una sola vez, cuando la base está vacía. Copia el esquema con los datos de ejemplo:
```bash
cp backend/query.sql docker/db/init/01-inventory.sql
```
> Si tienes un respaldo propio (`mariadb-dump`), puedes poner ese archivo en su lugar.

**4. Construir y arrancar**
```bash
docker compose up --build
```
La primera vez tarda unos minutos (descarga imágenes, instala dependencias y compila Angular). Está listo cuando el log del backend muestra `Booting worker`.

**5. Abrir** <http://localhost:4200> e iniciar sesión con un usuario de prueba:

| Usuario                     | Rol      | Contraseña |
| --------------------------- | -------- | ---------- |
| `don_rigo23@elclavo.com`    | Dueño    | `12345`    |
| `kevin.pinones@elclavo.com` | Empleado | `12345`    |
| `david.jimenes@elclavo.com` | Empleado | `12345`    |

Los datos de ejemplo traen categorías, productos, presentaciones y proveedores, pero **sin existencia**: empieza por *Entradas* (ingresar una factura) o por *Cargar desde Excel* para tener mercadería que vender.

### Comandos útiles

```bash
docker compose up -d             # arrancar en segundo plano
docker compose logs -f backend   # ver el log de Flask
docker compose ps                # estado de los contenedores
docker compose down              # detener (los datos se conservan)
docker compose down -v           # detener y BORRAR la base de datos (vuelve a cargar docker/db/init/ al arrancar)
docker compose up --build        # reconstruir después de cambiar el código
```

Para entrar a la base de datos desde tu computadora: `localhost`, puerto `3307`, base `inventory`, con el `DB_USER` y `DB_PASSWORD` del `.env`.

> Si después cambias el esquema (`ALTER TABLE …`), la base que ya existe no se actualiza sola: ejecuta el cambio a mano o haz `docker compose down -v` para empezar de cero.

## Desarrollo sin Docker (opcional)

Necesitas Python 3.13, Node.js 24 y MariaDB 11 instalados, con una base `inventory` creada a partir de `backend/query.sql`.

**Backend** (http://localhost:5000):
```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
# crear backend/app/.env con: FLASK_KEY, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET, JWT_EXPIRES_IN
.venv/bin/python main.py
```

**Frontend** (http://localhost:4200; las llamadas a `/api` pasan a Flask por `proxy.conf.json`):
```bash
cd frontend/inventory-display
npm install
npx ng serve
```
