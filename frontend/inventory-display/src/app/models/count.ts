// Same shapes Flask returns in backend/app/counts/counts.py (HU-32/33/34 physical count)
import { UnidadBase } from './product';

export type CountEstado = 'abierto' | 'aplicado' | 'cancelado';

export interface Count {
  id: number;
  estado: CountEstado;
  creado_en: string; // ISO datetime
  creado_por_id: number;
  creado_por: string;
  cerrado_en: string | null; // applied (HU-34) or cancelled
  cerrado_por_id: number | null;
  cerrado_por: string | null;
  productos: number;
  contados: number; // HU-33: how many already have what was counted
  ajustes: number; // HU-34: how many adjustments it applied
}

// One product of the count. HU-32: no system stock here, so the count is honest
export interface CountItem {
  id: number;
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  activo: boolean;
  categoria_id: number;
  categoria: string | null;
  contado: number | null; // null = not counted yet
  contado_en: string | null;
  contado_por_id: number | null;
  contado_por: string | null;
}

export interface CountDetail extends Count {
  items: CountItem[]; // by category, then name
  categorias: (string | null)[];
}

// HU-33: one line of a sheet. contado null = leave it as not counted
export interface CountItemInput {
  producto_id: number;
  contado: number | null;
}

// HU-33 (owner only): the item with the system's stock right now and the money
export interface CountCompareItem extends CountItem {
  existencia: number;
  precio_compra: number | null;
  diferencia: number | null; // contado − existencia; null = not counted yet
  dinero: number | null; // diferencia × precio_compra; null if not counted or no price
  ajuste: CountApplied | null; // HU-34: what was applied; null = not adjusted
}

// HU-34: one adjustment a count applied. cantidad signed (+ sobraba, − faltaba)
export interface CountApplied {
  tipo: 'ajuste_mas' | 'ajuste_menos';
  cantidad: number;
  motivo: string;
  dinero: number | null;
}

export interface CountCompareSummary {
  productos: number;
  contados: number;
  pendientes: number;
  con_diferencia: number;
  faltante: number; // Q of what is missing (positive)
  sobrante: number; // Q of what is extra
  neto: number; // sobrante − faltante
  sin_precio: number; // with a difference but no purchase price
}

export interface CountComparison extends Count {
  items: CountCompareItem[];
  categorias: (string | null)[];
  resumen: CountCompareSummary;
}

// HU-34: why the shelf and the system did not match. "Otro" needs a detalle
export const ADJUSTMENT_REASONS = [
  'Pérdida',
  'Error de registro',
  'Producto dañado',
  'Producto encontrado',
  'Otro',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

// What the owner approves. diferencia is what they saw, so Flask can tell if it changed
export interface CountAdjustmentInput {
  producto_id: number;
  motivo: AdjustmentReason;
  detalle?: string;
  diferencia: number;
}

// 409 from apply-count: the difference is not the one the owner approved anymore
export interface CountChangedProduct {
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  existencia: number;
  contado: number | null;
  diferencia: number | null;
  aprobada: number;
}
