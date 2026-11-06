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

// What the form sends to POST /api/v1/add-product
export interface NewProduct {
  codigo: string;
  nombre: string;
  precio: number;
  unidad_base: UnidadBase;
  stock_minimo: number | null; // null = no alerts (HU-21)
  categoria_id: number | null;
}

// What Flask returns after creating it
export interface Product extends NewProduct {
  id: number;
  activo: boolean;
}

// One row of GET /api/v1/products
export interface ProductListItem extends Product {
  categoria: string | null;
  existencia: number; // calculated from movements, in unidad_base
}
