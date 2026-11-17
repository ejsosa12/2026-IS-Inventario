"""HU-31: load what the store already has from an Excel file (owner only).

1. GET  initial-load/template  -> the .xlsx to fill in (Productos + Instrucciones).
2. POST initial-load/preview   -> checks the file and answers every row with its errors.
3. POST initial-load           -> checks it again and saves everything, or nothing.

Rows with a new codigo create the product with its initial stock. Rows whose codigo already
exists only load the stock (and purchase price) of a product WITHOUT movements: after the
first movement, the way to correct the stock is a physical count (HU-32/33/34).
"""
import unicodedata
from datetime import datetime
from io import BytesIO
from zipfile import BadZipFile

import pymysql
from flask import g, request, send_file
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from app.access_data import AccessData, ProductHasMovements
from app.security import requiere_rol

from .catalog import (
    PRICE_MAX, UNIDADES_BASE, _decimals_ok, _error, _optional_number, catalog, read_initial_stock,
    read_new_product,
)

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
SHEET = "Productos"
# What goes in the kárdex (HU-20) next to the 'inicial' movement
MOTIVO = "Carga inicial desde Excel"

# (key, title in the template, width, note for the Instrucciones sheet)
COLUMNS = [
    ("codigo", "Código", 14, "Obligatorio. Máximo 30 caracteres. Si ya existe, solo se carga su existencia."),
    ("nombre", "Nombre", 40, "Obligatorio para productos nuevos. Máximo 100 caracteres."),
    ("categoria", "Categoría", 22, "Obligatoria para productos nuevos. Elija una de la lista."),
    ("unidad_base", "Unidad", 10, "Obligatoria para productos nuevos: unidad, lb, m o gal."),
    ("precio", "Precio venta", 14, "Obligatorio para productos nuevos. Por unidad, máximo 2 decimales."),
    ("precio_compra", "Precio compra", 14,
     "Por unidad, máximo 4 decimales. Obligatorio si hay existencia (para saber cuánto vale)."),
    ("stock_minimo", "Mínimo", 10, "Opcional. Vacío = el producto no avisa cuando se está acabando."),
    ("existencia", "Existencia", 12,
     "Lo que hay hoy en el estante, en la unidad del producto. Vacío = 0. Entero si es por unidad."),
]
UNIDAD_ALIASES = {
    "unidad": "unidad", "unidades": "unidad", "u": "unidad",
    "lb": "lb", "libra": "lb", "libras": "lb",
    "m": "m", "metro": "m", "metros": "m",
    "gal": "gal", "galon": "gal", "galones": "gal",
}


def _plain(text):
    """Lowercase without accents or extra spaces: 'Plomería ' == 'plomeria'."""
    text = unicodedata.normalize("NFD", str(text or ""))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(text.lower().split())


def _cell_text(value):
    """Excel gives 1001 back as 1001.0: a code or a name is text, without the .0."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


@catalog.route('api/v1/initial-load/template', methods=['GET'])
@requiere_rol('admin')
def initial_load_template():
    categories = [c["nombre"] for c in AccessData().get_categories() if c["activo"]]

    book = Workbook()
    sheet = book.active
    sheet.title = SHEET
    header_fill = PatternFill("solid", fgColor="1E40AF")
    for index, (_, title, width, _) in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=1, column=index, value=title)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        sheet.column_dimensions[cell.column_letter].width = width
    sheet.freeze_panes = "A2"

    # Drop-down lists. The categories live in a hidden sheet (a list can be long)
    lists = book.create_sheet("Listas")
    for row, name in enumerate(categories, start=1):
        lists.cell(row=row, column=1, value=name)
    lists.sheet_state = "hidden"
    last = MAX_ROWS + 1
    if categories:
        category_list = DataValidation(type="list", formula1=f"=Listas!$A$1:$A${len(categories)}",
                                       allow_blank=True, showErrorMessage=True,
                                       errorTitle="Categoría", error="Elija una categoría de la lista")
        sheet.add_data_validation(category_list)
        category_list.add(f"C2:C{last}")
    unit_list = DataValidation(type="list", formula1=f'"{",".join(UNIDADES_BASE)}"', allow_blank=True,
                               showErrorMessage=True, errorTitle="Unidad", error="Use unidad, lb, m o gal")
    sheet.add_data_validation(unit_list)
    unit_list.add(f"D2:D{last}")

    help_sheet = book.create_sheet("Instrucciones")
    help_sheet.column_dimensions["A"].width = 16
    help_sheet.column_dimensions["B"].width = 90
    help_sheet["A1"] = "Inventario inicial · Ferretería El Buen Clavo"
    help_sheet["A1"].font = Font(bold=True, size=14)
    help_sheet["A2"] = (f"Llene la hoja '{SHEET}', una fila por producto (máximo {MAX_ROWS}). "
                        "No cambie los títulos de la primera fila.")
    help_sheet["A3"] = "Si una sola fila tiene error no se guarda nada: corrija el archivo y súbalo de nuevo."
    for row, (_, title, _, note) in enumerate(COLUMNS, start=5):
        help_sheet.cell(row=row, column=1, value=title).font = Font(bold=True)
        help_sheet.cell(row=row, column=2, value=note)
    example = len(COLUMNS) + 6
    help_sheet.cell(row=example, column=1, value="Ejemplo").font = Font(bold=True)
    help_sheet.cell(row=example, column=2,
                    value="CLA-010 | Clavo de 3 pulgadas | Clavos | lb | 9.50 | 6.25 | 20 | 75")

    output = BytesIO()
    book.save(output)
    output.seek(0)
    return send_file(
        output, as_attachment=True, download_name="plantilla-inventario-inicial.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _read_upload():
    """The uploaded .xlsx as rows of {key: value, 'fila': n}. Returns (rows, error message)."""
    upload = request.files.get("archivo")
    if upload is None or not upload.filename:
        return None, "Suba el archivo de Excel"
    if not upload.filename.lower().endswith(".xlsx"):
        return None, "El archivo debe ser de Excel (.xlsx). Use la plantilla"
    content = upload.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        return None, "El archivo pesa más de 2 MB"
    try:
        book = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except (BadZipFile, KeyError, ValueError, OSError):
        return None, "No se pudo leer el archivo. ¿Es un Excel (.xlsx)?"

    sheet = book[SHEET] if SHEET in book.sheetnames else book.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = next(rows, None) or ()
    titles = {_plain(title): key for key, title, _, _ in COLUMNS}
    positions = {}
    for index, value in enumerate(header):
        key = titles.get(_plain(value))
        if key and key not in positions:
            positions[key] = index
    missing = [title for key, title, _, _ in COLUMNS if key not in positions]
    if missing:
        return None, f"Faltan las columnas: {', '.join(missing)}. Use la plantilla sin cambiar los títulos"

    result = []
    for number, values in enumerate(rows, start=2):
        row = {key: (values[i] if i < len(values) else None) for key, i in positions.items()}
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in row.values()):
            continue  # empty rows in between are fine
        if len(result) == MAX_ROWS:
            book.close()
            return None, f"El archivo tiene más de {MAX_ROWS} productos. Divídalo en varios"
        result.append({**row, "fila": number})
    book.close()
    if not result:
        return None, "El archivo no tiene productos"
    return result, None


def _check_rows(access, rows):
    """Checks every row. Returns (preview rows for Angular, nuevos, existentes)."""
    categories = {_plain(c["nombre"]): c for c in access.get_categories()}
    products = {_plain(p["codigo"]): p for p in access.get_products_for_initial_load()}
    seen = {}
    preview, nuevos, existentes = [], [], []

    for row in rows:
        codigo = _cell_text(row["codigo"])
        key = _plain(codigo)
        errors = []
        if key and key in seen:
            errors.append(f"El código se repite (fila {seen[key]})")
        elif key:
            seen[key] = row["fila"]

        existing = products.get(key) if key else None
        item = {"fila": row["fila"], "codigo": codigo, "accion": "existente" if existing else "nuevo"}

        if existing:
            # Only the stock and the purchase price count; the rest of the row is ignored
            precio_compra, bad = _optional_number(row["precio_compra"])
            if bad:
                errors.append("El precio de compra debe ser un número")
                precio_compra = None
            elif precio_compra is not None and (
                    precio_compra < 0 or not _decimals_ok(precio_compra, 4) or precio_compra >= PRICE_MAX):
                errors.append("El precio de compra no puede ser negativo y lleva máximo 4 decimales")
                precio_compra = None
            if existing["tiene_movimientos"]:
                errors.append("Este producto ya tiene movimientos: ya no es inventario inicial. "
                              "Para corregir su existencia haga un conteo físico")
            existencia, problems = read_initial_stock(
                row["existencia"], existing["unidad_base"],
                precio_compra if precio_compra is not None else existing["precio_compra"])
            errors += problems
            item.update({
                "producto_id": existing["id"], "nombre": existing["nombre"],
                "categoria": existing["categoria"], "unidad_base": existing["unidad_base"],
                "precio": None, "stock_minimo": None,
                "precio_compra": float(precio_compra) if precio_compra is not None else (
                    float(existing["precio_compra"]) if existing["precio_compra"] is not None else None),
                "existencia": float(existencia) if existencia is not None else None,
            })
            if not errors:
                existentes.append({"producto_id": existing["id"], "codigo": existing["codigo"],
                                   "existencia": existencia, "precio_compra": precio_compra})
        else:
            unidad = UNIDAD_ALIASES.get(_plain(row["unidad_base"]))
            fields, problems = read_new_product({
                "codigo": codigo, "nombre": _cell_text(row["nombre"]),
                "unidad_base": unidad if unidad else _cell_text(row["unidad_base"]) or None,
                "precio": row["precio"], "precio_compra": row["precio_compra"],
                "stock_minimo": row["stock_minimo"], "existencia": row["existencia"],
            })
            errors += problems
            category_name = _cell_text(row["categoria"])
            category = categories.get(_plain(category_name))
            if not category_name:
                errors.append("La categoría es obligatoria")
            elif category is None:
                errors.append(f"La categoría '{category_name}' no existe")
            elif not category["activo"]:
                errors.append(f"La categoría '{category['nombre']}' está inactiva")
            item.update({
                "producto_id": None, "nombre": fields["nombre"],
                "categoria": category["nombre"] if category else category_name or None,
                "unidad_base": fields["unidad_base"],
                **{k: float(fields[k]) if fields[k] is not None else None
                   for k in ("precio", "precio_compra", "stock_minimo", "existencia")},
            })
            if not errors:
                nuevos.append({**fields, "categoria_id": category["id"]})

        item["errores"] = errors
        preview.append(item)
    return preview, nuevos, existentes


def _summary(preview):
    valid = [r for r in preview if not r["errores"]]
    return {
        "filas": len(preview),
        "nuevos": sum(1 for r in valid if r["accion"] == "nuevo"),
        "existentes": sum(1 for r in valid if r["accion"] == "existente"),
        "con_error": len(preview) - len(valid),
        # HU-26: what the loaded stock is worth (rows without errors)
        "valor": round(sum((r["existencia"] or 0) * (r["precio_compra"] or 0) for r in valid), 2),
    }


@catalog.route('api/v1/initial-load/preview', methods=['POST'])
@requiere_rol('admin')
def initial_load_preview():
    rows, problem = _read_upload()
    if problem:
        return _error(problem)
    preview, _, _ = _check_rows(AccessData(), rows)
    return {
        "status": 0,
        "message": "SUCCESS: file checked",
        "data": {"filas": preview, "resumen": _summary(preview)},
    }, 200


@catalog.route('api/v1/initial-load', methods=['POST'])
@requiere_rol('admin')
def initial_load():
    """Checks the file again (it may have changed, or the DB) and saves all or nothing."""
    rows, problem = _read_upload()
    if problem:
        return _error(problem)
    access = AccessData()
    preview, nuevos, existentes = _check_rows(access, rows)
    data = {"filas": preview, "resumen": _summary(preview)}
    if data["resumen"]["con_error"]:
        return {"status": 1, "message": "the file has errors, nothing was saved", "data": data}, 400

    try:
        access.initial_load(nuevos, existentes, g.user["users"], MOTIVO)
    except ProductHasMovements as error:
        return {
            "status": 1,
            "message": "products got movements meanwhile, nothing was saved",
            "data": {"codigos": error.codigos},
        }, 409
    except pymysql.err.IntegrityError:
        # Someone created one of these codes while the file was being saved
        return _error("a product code was taken meanwhile, nothing was saved", 409)

    data["guardado_en"] = datetime.now().isoformat()
    return {"status": 0, "message": "SUCCESS: initial stock loaded", "data": data}, 201
