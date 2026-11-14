// Same shapes Flask returns in backend/app/catalog/catalog.py

export type UnidadBase = 'unidad' | 'lb' | 'm';

export interface ApiResponse<T> {
  status: number; // 0 = ok, 1 = error
  message: string;
  data: T | null;
}

export interface Category {
  id: number;
  nombre: string;
}

// HU-06: how the product is bought. "caja" with factor 50 = 1 caja holds 50 lb
export interface NewPresentation {
  nombre: string;
  factor: number; // how many base units it holds
}

// What the form sends to POST /api/v1/add-product
export interface NewProduct {
  codigo: string;
  nombre: string;
  precio: number;
  unidad_base: UnidadBase;
  stock_minimo: number | null; // null = no alerts (HU-21)
  categoria_id: number | null;
  presentaciones?: NewPresentation[]; // optional, empty = bought in the base unit
}

// What Flask returns after creating it
export interface Product extends NewProduct {
  id: number;
  activo: boolean;
}

// HU-22: one row of GET /api/v1/low-stock (active products at or below their minimum)
export interface LowStockItem {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad_base: UnidadBase;
  existencia: number;
  stock_minimo: number;
  faltan: number; // what is missing to get back to the minimum
  agotado: boolean; // existencia is 0
}

// One row of GET /api/v1/products
export interface ProductListItem extends Product {
  categoria: string | null;
  existencia: number; // calculated from movements, in unidad_base
}
