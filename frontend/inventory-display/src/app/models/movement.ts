// Same shapes Flask returns in backend/app/movements/movements.py (HU-20 kárdex)
import { UnidadBase } from './product';

export type MovementTipo =
  | 'entrada'
  | 'venta'
  | 'dano'
  | 'uso'
  | 'anulacion'
  | 'ajuste_mas' // HU-34: the count found more than the system had
  | 'ajuste_menos'; // HU-34: the count found less

// One row of the kárdex
export interface ProductMovement {
  id: number;
  tipo: MovementTipo;
  fecha: string; // ISO datetime
  cantidad: number; // signed, in the base unit: + came in, - went out
  existencia: number; // stock right after this movement
  usuario_id: number;
  usuario: string;
  motivo: string | null; // dano, uso, anulacion, ajustes
  precio: number | null; // per base unit
  costo: number | null; // |cantidad| × precio, in quetzales
  proveedor_id: number | null;
  proveedor: string | null;
  entrada_id: number | null;
  numero_factura: string | null;
  conteo_id: number | null; // HU-34: the physical count that made an ajuste
  anulada: boolean; // an entrada that was voided later (HU-14)
  presentacion: string | null; // "caja": how it came on the invoice
  cantidad_presentacion: number | null;
}

export interface ProductHistory {
  producto: {
    id: number;
    codigo: string;
    nombre: string;
    unidad_base: UnidadBase;
    activo: boolean;
    categoria: string | null;
    existencia: number;
  };
  // The whole date range, not only this page
  resumen: { inicio: number; entro: number; salio: number; final: number };
  movimientos: ProductMovement[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

export interface ProductHistoryFilter {
  desde?: string | null; // YYYY-MM-DD
  hasta?: string | null;
  page?: number;
  per_page?: number;
}
