// Same shapes Flask returns in backend/app/movements/movements.py (HU-20 kárdex)
import { UnidadBase } from './product';

export type MovementTipo =
  | 'entrada'
  | 'venta'
  | 'dano'
  | 'uso'
  | 'anulacion'
  | 'ajuste_mas' // HU-34: the count found more than the system had
  | 'ajuste_menos' // HU-34: the count found less
  | 'inicial'; // HU-31: what the store had when it started using the system

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
  venta_id: number | null; // HU-15: the sale (ticket) of a 'venta' row
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

// HU-27: one row of the movements report (every product, so each row says which one)
export interface ReportMovement extends Omit<ProductMovement, 'existencia'> {
  producto_id: number;
  codigo: string;
  producto: string;
  unidad_base: UnidadBase;
}

export interface MovementsReport {
  movimientos: ReportMovement[];
  // The whole range. por_tipo ignores the type filter and por_usuario the user filter,
  // so the other options show their numbers too
  por_tipo: { tipo: MovementTipo; movimientos: number; dinero: number | null }[];
  por_usuario: { usuario_id: number; usuario: string; movimientos: number }[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

export interface MovementsFilter {
  desde?: string | null; // YYYY-MM-DD
  hasta?: string | null;
  tipo?: MovementTipo | null;
  usuario_id?: number | null;
  page?: number;
  per_page?: number;
}
