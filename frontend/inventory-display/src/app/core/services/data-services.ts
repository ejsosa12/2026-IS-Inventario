import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map } from 'rxjs';
import { ApiResponse, Category, NewProduct, Product, ProductListItem } from '../../models/product';
import { NewSupplier, Supplier } from '../../models/supplier';
import { Entry, EntryListItem, NewEntry, Presentation } from '../../models/entry';

// Talks to the Flask API. The auth-interceptor adds the Bearer token to every request
@Service()
export class DataServices {
  private readonly API_URL = 'http://localhost:5000/api/v1';
  private http = inject(HttpClient);

  getProducts() {
    return this.http
      .get<ApiResponse<ProductListItem[]>>(`${this.API_URL}/products`)
      .pipe(map((response) => response.data ?? []));
  }

  getCategories() {
    return this.http
      .get<ApiResponse<Category[]>>(`${this.API_URL}/categories`)
      .pipe(map((response) => response.data ?? []));
  }

  addProduct(product: NewProduct) {
    return this.http
      .post<ApiResponse<Product>>(`${this.API_URL}/add-product`, product)
      .pipe(map((response) => response.data as Product));
  }

  getSuppliers() {
    return this.http
      .get<ApiResponse<Supplier[]>>(`${this.API_URL}/suppliers`)
      .pipe(map((response) => response.data ?? []));
  }

  addSupplier(supplier: NewSupplier) {
    return this.http
      .post<ApiResponse<Supplier>>(`${this.API_URL}/add-supplier`, supplier)
      .pipe(map((response) => response.data as Supplier));
  }

  getSupplier(id: number) {
    return this.http
      .get<ApiResponse<Supplier>>(`${this.API_URL}/suppliers/${id}`)
      .pipe(map((response) => response.data as Supplier));
  }

  // HU-09: edit the supplier data (not its status)
  editSupplier(id: number, supplier: NewSupplier) {
    return this.http
      .put<ApiResponse<Supplier>>(`${this.API_URL}/edit-supplier/${id}`, supplier)
      .pipe(map((response) => response.data as Supplier));
  }

  // HU-09: deactivate (activo false) or reactivate a supplier
  setSupplierStatus(id: number, activo: boolean) {
    return this.http
      .put<ApiResponse<Supplier>>(`${this.API_URL}/supplier-status/${id}`, { activo })
      .pipe(map((response) => response.data as Supplier));
  }

  getPresentations() {
    return this.http
      .get<ApiResponse<Presentation[]>>(`${this.API_URL}/presentations`)
      .pipe(map((response) => response.data ?? []));
  }

  // HU-11 and HU-12: one invoice with all its products
  addEntry(entry: NewEntry) {
    return this.http
      .post<ApiResponse<Entry>>(`${this.API_URL}/add-entry`, entry)
      .pipe(map((response) => response.data as Entry));
  }

  // onlyWithShortages = HU-12 list of "entradas con faltantes"
  getEntries(onlyWithShortages = false) {
    const params = onlyWithShortages ? { faltantes: 'true' } : undefined;
    return this.http
      .get<ApiResponse<EntryListItem[]>>(`${this.API_URL}/entries`, { params })
      .pipe(map((response) => response.data ?? []));
  }

  getEntry(id: number) {
    return this.http
      .get<ApiResponse<Entry>>(`${this.API_URL}/entries/${id}`)
      .pipe(map((response) => response.data as Entry));
  }
}
