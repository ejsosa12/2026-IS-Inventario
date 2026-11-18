import { MovementTipo } from '../../models/movement';

// How each movement type is shown: label and badge colors (Tailwind 2.2 palette).
// Shared by the kárdex (HU-20) and the movements report (HU-27).
export const MOVEMENT_TYPES: Record<MovementTipo, { label: string; classes: string }> = {
  entrada: { label: 'Compra', classes: 'bg-green-100 text-green-800' },
  venta: { label: 'Venta', classes: 'bg-yellow-100 text-yellow-800' },
  dano: { label: 'Merma', classes: 'bg-red-100 text-red-800' },
  uso: { label: 'Uso interno', classes: 'bg-blue-100 text-blue-800' },
  anulacion: { label: 'Anulación', classes: 'bg-purple-100 text-purple-800' },
  ajuste_mas: { label: 'Ajuste (+)', classes: 'bg-indigo-100 text-indigo-800' },
  ajuste_menos: { label: 'Ajuste (−)', classes: 'bg-pink-100 text-pink-800' },
  inicial: { label: 'Inventario inicial', classes: 'bg-gray-100 text-gray-800' },
};
