// Same shapes Flask returns in backend/app/catalog/catalog.py

export type UnidadBase = 'unidad' | 'lb' | 'm' | 'gal';

export interface ApiResponse<T> {
  status: number; // 0 = ok, 1 = error
  message: string;
  data: T | null;
}

// HU-05: the owner creates, renames and deactivates them
export interface Category {
  id: number;
  nombre: string;
  activo: boolean; // inactive: its products keep it, new products cannot pick it
  productos: number; // how many products have it
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
  categoria_id: number; // HU-05: required
  presentaciones?: NewPresentation[]; // optional, empty = bought in the base unit
  // HU-31 by hand: what there is today and what it cost (required when existencia > 0)
  existencia?: number | null;
  precio_compra?: number | null;
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

// HU-02: one price change, made by the owner in "Editar producto"
export interface PriceChange {
  id: number;
  tipo: 'venta' | 'compra';
  precio_anterior: number | null; // null = it had no purchase price yet
  precio_nuevo: number;
  fecha: string; // ISO datetime
  usuario: string;
}

// GET /api/v1/products/<id> (owner only): what the edit page needs
export interface ProductDetail extends Product {
  precio_compra: number | null; // per base unit; each invoice updates it
  presentaciones: (NewPresentation & { id: number })[];
  tiene_movimientos: boolean; // then unidad_base cannot change
  historial_precios: PriceChange[];
}

// What PUT /api/v1/edit-product/<id> takes (HU-21 mínimo, HU-02 precios)
export interface EditProductRequest {
  codigo: string;
  nombre: string;
  categoria_id: number; // HU-05: required
  unidad_base: UnidadBase;
  stock_minimo: number | null;
  precio: number;
  precio_compra: number | null;
}

// One row of GET /api/v1/products
export interface ProductListItem extends Product {
  categoria: string | null;
  existencia: number; // calculated from movements, in unidad_base
}
