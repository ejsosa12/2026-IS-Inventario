// Same shapes Flask returns in backend/app/catalog/initial_load.py (HU-31)
import { UnidadBase } from './product';

// One row of the Excel file, as Flask understood it
export interface InitialLoadRow {
  fila: number; // row number in Excel (the titles are row 1)
  codigo: string;
  accion: 'nuevo' | 'existente'; // create the product, or only load its stock
  producto_id: number | null;
  nombre: string;
  categoria: string | null;
  unidad_base: UnidadBase | null;
  precio: number | null; // sale price; null for an existing product (not changed)
  precio_compra: number | null;
  stock_minimo: number | null;
  existencia: number | null;
  errores: string[]; // in Spanish, ready to show
}

export interface InitialLoadSummary {
  filas: number;
  nuevos: number;
  existentes: number;
  con_error: number;
  valor: number; // existencia × precio_compra of the rows without errors
}

export interface InitialLoadResult {
  filas: InitialLoadRow[];
  resumen: InitialLoadSummary;
}
