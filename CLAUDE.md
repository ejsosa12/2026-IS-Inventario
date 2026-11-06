# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Inventory module for a hypothetical hardware store ("Ferretería El Buen Clavo"), a university Software Engineering project. Requirements live **outside this repo** in `../inventario-especificaciones/` (user stories HU-01..HU-34 in `user-stories/User-Stories.pdf`, a story map with releases R1/R2/R3, and C4 architecture diagrams). Code comments reference story ids (`# HU-09: ...`); keep doing that when implementing a story.

The user writes in Spanish. UI text and DB column names are Spanish; code comments are English.

## Commands

Frontend (`frontend/inventory-display/`, Angular 22, served on http://localhost:4200):
```bash
npx ng serve            # dev server
npx ng build            # build; use this to check templates/types compile
npx ng test --watch=false   # unit tests (Vitest + jsdom via @angular/build:unit-test)
npx ng test --watch=false --include src/app/core/services/auth-service.spec.ts   # single spec
```
Formatting is Prettier (`printWidth: 100`, single quotes, Angular parser for HTML), configured in `.prettierrc`.

Backend (`backend/`, Flask on http://localhost:5000, run from `backend/`):
```bash
.venv/bin/pip install -r requirements.txt   # only direct dependencies, written by hand (not pip freeze)
.venv/bin/python main.py      # debug=True, auto-reloads
```
There is no backend test suite. Endpoints are checked ad hoc with `create_app().test_client()` (log in via `POST /api/v1/login` to get a token) or curl. The user usually has their own Flask already running on port 5000, so prefer `test_client` over starting or killing a server. Always delete test rows you insert into the database.


## Architecture

### Backend (Flask + MariaDB)
- `app/__init__.py` `create_app()` loads `.env` (located at `backend/app/.env`: `FLASK_KEY`, `DB_*`, `JWT_SECRET`, `JWT_EXPIRES_IN` in hours), enables CORS for `http://localhost:4200` only, and registers one blueprint per feature folder (`auth`, `catalog`, `suppliers`) with `url_prefix='/'`. Routes declare the full path themselves: `@bp.route('api/v1/<name>')`. Empty folders (`alerts`, `movements`, `units`, `inventory-service`) are placeholders for future features.
- `app/access_data/access_data.py` `AccessData` is the only place with SQL. Pymysql with `DictCursor`, one connection per method via the `_connection()` context manager, explicit `conn.commit()` on writes. Add new queries as methods here.
- `app/security/require_role.py` `@requiere_rol(*roles)` goes under `@bp.route`. It validates the `Authorization: Bearer` JWT (HS256), reloads the user from the DB and sets `g.user`. Missing/expired/invalid token or an inactive user returns 401; wrong role returns 403. `@requiere_rol()` with no args means any logged-in user. Roles are `admin` (owner) and `employee`; writes to the catalog and suppliers are `admin` only.
- Response shape: `{"status": 0|1, "message": ..., "data": ...}` (0 = ok). Login is the exception: it returns `token` at the top level. Validation errors are 400, a duplicate unique value is 409 (check first, and also catch `pymysql.err.IntegrityError`), and creation is 201.
- Decimals and tinyint booleans are converted to `float`/`bool` before returning (see `_product_to_json` in `catalog.py`).
- Optional unique strings (e.g. `suppliers.nit`) must be stored as `NULL` when empty, never `''`, so the UNIQUE constraint allows several blanks.

### Database
`backend/query.sql` holds the schema (C4 level 4 data model) and seed data. Keep it in sync when the schema changes. `backend/inventory_dump.sql` is a full `mariadb-dump` of the `inventory` DB with dummy data (drops and recreates every table); it is a snapshot, not the source of truth for the schema. The DB user lacks CREATE privileges, so the user runs DDL (`ALTER TABLE`, etc.) themselves; provide the query instead of executing it.
- `users` PK column is named `users` (not `id`). Passwords are stored as SHA256 hex.
- **Stock is never stored**: existencia = SUM over `movements` (`entrada` adds; `venta`, `dano`, `uso` subtract), always in the product's `unidad_base` (`unidad` integers only; `lb`/`m` allow decimals, HU-07).
- `presentations` convert purchase units to base units (1 caja = 50 lb).
- Soft delete via `activo` on `products` (HU-04: inactive products are hidden from searches) and `users` (HU-30: inactive users cannot log in).
- `stock_minimo` NULL means the product generates no low-stock alerts (HU-21).

### Frontend (Angular 22, standalone components, signals)
- `app.routes.ts`: `home` (guarded by `publicGuard`, holds `login`) and `content` (guarded by `authGuard`). `content` renders the `SideBar` plus a `<router-outlet>`; feature pages are its lazy-loaded children (`dashboard`, `settings`, `products`, `products/add-product`, `suppliers`, `suppliers/add-supplier`).
- `core/services/auth-service.ts` keeps the JWT in localStorage and a signal. `isAuthenticated()` decodes the token's `exp` client-side and logs out when it has expired.
- `core/services/auth-interceptor.ts` (functional interceptor registered in `app.config.ts`) adds the Bearer token to every request except login, and on any 401 logs out and redirects to `/home/login`. Components therefore do not handle 401, only 0/403/409 and the like.
- `core/services/data-services.ts` `DataServices` wraps all non-auth API calls and maps `response.data`. Response and entity interfaces live in `models/`, mirroring the Flask JSON.
- Feature components live in `utils/<name>/`. List pages (`products`, `suppliers`) follow the same pattern: `loading`/`error` signals, a `query` signal bound to the search input, and a `filtered` computed that matches every typed word against accent-stripped, lowercased text. Add pages (`add-product`, `add-supplier`) use reactive forms with `invalid(field)`, `saving`/`error`/`created` signals, and an `errorMessage()` that maps HTTP status codes to Spanish messages.
- Services use Angular 22's `@Service()` decorator.

### Styling quirks
Tailwind v4 is set up through PostCSS (`src/styles.css`), but `src/index.html` also loads a Tailwind 2.2 CDN stylesheet. Many component templates were copied from a "Cordes" dashboard theme and still contain `<head>`, `<script>` and `<body>` tags. Angular ignores these, so the custom `cordes-*` colors and the Font Awesome icons they reference are not actually loaded. Use plain Tailwind color classes. Internal links should use `routerLink`, not `href`, to avoid a full page reload.
