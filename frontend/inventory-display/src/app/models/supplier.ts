// Same shapes Flask returns in backend/app/suppliers/suppliers.py
import { UnidadBase } from './product';

// What the form sends to POST /api/v1/add-supplier and PUT /api/v1/edit-supplier/<id>
export interface NewSupplier {
  nombre: string;
  telefono: string | null; // optional
  contacto: string | null; // optional (HU-09): seller or contact name
  nit: string | null; // optional (HU-09), unique
}

// One row of GET /api/v1/suppliers
export interface Supplier extends NewSupplier {
  id: number;
  activo: boolean; // HU-09: deactivated suppliers stay for old entries
}

// HU-10: the last purchase of one product from one supplier (only valid invoices)
export interface SupplierPurchase {
  producto_id: number;
  codigo: string;
  nombre: string;
  unidad_base: UnidadBase;
  activo: boolean;
  categoria: string | null;
  proveedor_id: number;
  proveedor: string;
  proveedor_activo: boolean;
  telefono: string | null;
  precio: number; // per base unit
  presentacion: string | null; // "caja" if it came that way; null = in the base unit
  factor: number | null;
  precio_presentacion: number | null; // as on the invoice: Q400 per caja
  fecha_factura: string; // YYYY-MM-DD (format by hand, not with DatePipe)
  numero_factura: string;
  entrada_id: number;
  precio_anterior: number | null; // the purchase before, from the same supplier
  fecha_anterior: string | null;
  cambio: number | null; // % against precio_anterior
  veces: number; // how many times it was bought from this supplier
  total: number; // how much, in the base unit
  mas_barato?: boolean; // only from GET products/<id>/suppliers
}

// GET /api/v1/suppliers/<id>/products
export interface SupplierProducts {
  proveedor: Supplier;
  resumen: {
    productos: number;
    facturas: number;
    ultima_compra: string | null; // YYYY-MM-DD
  };
  productos: SupplierPurchase[];
}
