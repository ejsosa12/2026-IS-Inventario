// Same shapes Flask returns in backend/app/catalog/catalog.py (reports)
import { UnidadBase } from './product';

// HU-26: one product with stock and what it is worth at its purchase price
export interface InventoryValueProduct {
  id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  activo: boolean;
  categoria_id: number;
  categoria: string | null;
  existencia: number;
  precio_compra: number | null; // per base unit; null = never bought, left out of the total
  valor: number | null; // existencia × precio_compra
}

export interface InventoryValueCategory {
  categoria_id: number;
  categoria: string | null;
  productos: number; // products with stock in it
  valor: number;
  porcentaje: number; // of the grand total
  sin_precio: number;
}

export interface InventoryValue {
  total: number;
  productos_con_existencia: number;
  por_categoria: InventoryValueCategory[]; // most valuable first
  productos: InventoryValueProduct[]; // most valuable first, without price at the end
  sin_precio: InventoryValueProduct[];
}
