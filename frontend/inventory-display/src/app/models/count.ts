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
