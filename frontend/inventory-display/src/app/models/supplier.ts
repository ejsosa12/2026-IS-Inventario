// Same shapes Flask returns in backend/app/suppliers/suppliers.py

// What the form sends to POST /api/v1/add-supplier
export interface NewSupplier {
  nombre: string;
  telefono: string | null; // optional
  nit: string | null; // optional (HU-09), unique
}

// One row of GET /api/v1/suppliers
export interface Supplier extends NewSupplier {
  id: number;
}
