// HU-15: same shapes Flask returns in backend/app/sales/sales.py
import { UnidadBase } from './product';

// What the counter sends to POST /api/v1/add-sale. cantidad is in the base unit
export interface NewSale {
  nit_cliente: string; // "CF" or a NIT like "1234567-9"
  nombre_cliente: string; // empty = "Consumidor Final" when the NIT is CF
  items: { producto_id: number; cantidad: number }[];
}

export interface SaleItem {
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  cantidad: number;
  precio: number; // sale price per base unit at the moment of the sale
  subtotal: number;
}

export interface Sale {
  id: number;
  fecha: string; // ISO datetime
  nit_cliente: string;
  nombre_cliente: string;
  usuario_id: number;
  usuario: string;
  productos: number;
  total: number; // IVA included
  iva: number; // the IVA inside the total
  items?: SaleItem[]; // only in GET /sales/<id> and add-sale
}

export interface SalesOfDay {
  fecha: string; // YYYY-MM-DD
  ventas: Sale[];
  total: number;
}

// 409 from add-sale: these products do not reach (HU-18)
export interface SaleStockProblem {
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  existencia: number;
}
