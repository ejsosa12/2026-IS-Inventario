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
  devuelto: number; // HU-13: already returned
  por_devolver: number; // HU-13: what can still be returned
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
  devuelto: number; // HU-13: money already given back for returns
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

// HU-13: what the counter sends to POST /api/v1/add-return
export interface NewReturn {
  venta_id: number;
  motivo: string;
  items: { producto_id: number; cantidad: number; danado: boolean }[];
}

export interface ReturnResult {
  venta_id: number;
  devolver: number; // money to give back to the customer
  venta: Sale; // the sale again, with what is left to return
}

// HU-13: one returned product (GET /api/v1/returns)
export interface ReturnRow {
  id: number;
  fecha: string;
  venta_id: number;
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  cantidad: number;
  precio: number;
  monto: number;
  danado: boolean; // came damaged: registered and written off as a merma
  motivo: string | null;
  usuario: string;
}

// 409 from add-return: someone returned part of it meanwhile
export interface ReturnProblem {
  producto_id: number;
  nombre: string;
  unidad_base: UnidadBase;
  vendido: number;
  devuelto: number;
  por_devolver: number;
}
