// Same shapes Flask returns in backend/app/movements/movements.py and catalog.py
import { UnidadBase } from './product';

// HU-06: how a product is bought (1 caja = 50 lb). GET /api/v1/presentations
export interface Presentation {
  id: number;
  producto_id: number;
  nombre: string;
  factor: number; // how many base units it holds
}

// One product line of POST /api/v1/add-entry. Quantities and price as on the invoice
export interface NewEntryItem {
  producto_id: number;
  presentacion_id: number | null; // null = in the base unit
  cantidad: number; // received (HU-12), must be > 0
  cantidad_factura: number | null; // null = same as received
  precio: number; // per presentation
}

export interface NewEntry {
  proveedor_id: number;
  numero_factura: string;
  fecha_factura: string; // YYYY-MM-DD
  productos: NewEntryItem[];
}

// One product of a saved entry. Comes in base unit and as on the invoice
export interface EntryItem {
  id: number;
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  presentacion_id: number | null;
  presentacion: string | null;
  factor: number;
  cantidad: number;
  cantidad_factura: number;
  precio: number;
  cantidad_presentacion: number;
  cantidad_factura_presentacion: number;
  precio_presentacion: number;
  faltante: boolean;
}

interface EntryHeader {
  id: number;
  numero_factura: string;
  fecha_factura: string;
  fecha: string; // when it was saved
  proveedor_id: number;
  proveedor: string;
  usuario_id: number;
  usuario: string;
}

// One row of GET /api/v1/entries
export interface EntryListItem extends EntryHeader {
  total_productos: number;
  con_faltantes: boolean; // HU-12
}

// GET /api/v1/entries/<id> and the response of add-entry
export interface Entry extends EntryHeader {
  productos: EntryItem[];
}
