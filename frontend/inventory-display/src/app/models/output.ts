// Same shapes Flask returns in backend/app/movements/movements.py (outputs)
import { UnidadBase } from './product';

// HU-16 'dano' (merma) and HU-17 'uso' (uso interno). Sales come from the billing module
export type OutputTipo = 'dano' | 'uso';

// What the form sends to POST /api/v1/add-output. cantidad is always in the base unit
export interface NewOutput {
  tipo: OutputTipo;
  producto_id: number;
  cantidad: number;
  motivo: string;
}

// One row of GET /api/v1/outputs
export interface Output extends NewOutput {
  id: number;
  fecha: string; // ISO datetime
  codigo: string;
  producto: string;
  unidad_base: UnidadBase;
  usuario_id: number;
  usuario: string;
  precio: number | null; // last purchase price per base unit when it left
  costo: number | null; // cantidad × precio, in quetzales
}
