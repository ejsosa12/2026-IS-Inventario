// Same shapes Flask returns in backend/app/suppliers/suppliers.py

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
