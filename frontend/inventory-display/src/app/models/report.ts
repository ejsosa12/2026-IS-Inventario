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

// HU-24: what one product sold in the range (only 'venta' movements)
export interface TopSale {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad_base: UnidadBase;
  activo: boolean;
  cantidad: number; // sold, in the base unit
  ventas: number; // tickets it appears in
  dinero: number; // Σ cantidad × sale price
  existencia: number; // now
  stock_minimo: number | null;
  bajo_minimo: boolean; // at or below its mínimo (HU-22 rule)
}

// HU-24: one day of the chart
export interface SalesDay {
  fecha: string; // YYYY-MM-DD
  ventas: number;
  total: number;
}

export interface TopSalesReport {
  desde: string | null;
  hasta: string | null;
  resumen: { productos: number; ventas: number; dinero: number };
  productos: TopSale[]; // most sold quantity first
  por_dia: SalesDay[]; // every day of the range (0 when nothing was sold), oldest first
}

// Dashboard (every user, decided 2026-11-20): money in the store and the last N days of sales
export interface DashboardSummary {
  dinero_bodega: number; // HU-26 total
  desde: string;
  hasta: string;
  por_dia: SalesDay[];
}

// HU-25: a product with stock that did not sell in the chosen time
export interface StaleProduct {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad_base: UnidadBase;
  activo: boolean;
  existencia: number;
  precio_compra: number | null;
  dinero: number | null; // existencia × precio_compra; null = no purchase price
  ultima_venta: string | null; // YYYY-MM-DD; null = never sold
  dias_sin_vender: number; // since the last sale, or since it arrived if never sold
  nunca_vendido: boolean;
}

export interface StaleProductsReport {
  dias: number;
  desde: string;
  resumen: {
    productos: number;
    dinero: number;
    valor_bodega: number; // HU-26 total
    porcentaje: number; // dinero / valor_bodega
    nunca_vendidos: number;
    sin_precio: number;
  };
  productos: StaleProduct[]; // most money first, without price at the end
}
