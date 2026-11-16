import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map } from 'rxjs';
import {
  ApiResponse,
  Category,
  EditProductRequest,
  LowStockItem,
  NewProduct,
  Product,
  ProductDetail,
  ProductListItem,
} from '../../models/product';
import { NewSupplier, Supplier } from '../../models/supplier';
import { NewUser, User } from '../../models/user';
import { NewOutput, Output, OutputTipo } from '../../models/output';
import { InventoryValue } from '../../models/report';
import { ProductHistory, ProductHistoryFilter } from '../../models/movement';
import { CorrectEntry, Entry, EntryListItem, NewEntry, Presentation } from '../../models/entry';

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

  // HU-05 (owner only): create, rename, deactivate/reactivate
  addCategory(nombre: string) {
    return this.http
      .post<ApiResponse<Category>>(`${this.API_URL}/add-category`, { nombre })
      .pipe(map((response) => response.data as Category));
  }

  editCategory(id: number, nombre: string) {
    return this.http
      .put<ApiResponse<Category>>(`${this.API_URL}/edit-category/${id}`, { nombre })
      .pipe(map((response) => response.data as Category));
  }

  setCategoryStatus(id: number, activo: boolean) {
    return this.http
      .put<ApiResponse<Category>>(`${this.API_URL}/category-status/${id}`, { activo })
      .pipe(map((response) => response.data as Category));
  }

  addProduct(product: NewProduct) {
    return this.http
      .post<ApiResponse<Product>>(`${this.API_URL}/add-product`, product)
      .pipe(map((response) => response.data as Product));
  }

  // HU-21 / HU-02 (owner only): product with purchase price, presentations and price history
  getProduct(id: number) {
    return this.http
      .get<ApiResponse<ProductDetail>>(`${this.API_URL}/products/${id}`)
      .pipe(map((response) => response.data as ProductDetail));
  }

  editProduct(id: number, product: EditProductRequest) {
    return this.http
      .put<ApiResponse<ProductDetail>>(`${this.API_URL}/edit-product/${id}`, product)
      .pipe(map((response) => response.data as ProductDetail));
  }

  // HU-22: what is running out. Out of stock first, then furthest from the minimum
  getLowStock() {
    return this.http
      .get<ApiResponse<LowStockItem[]>>(`${this.API_URL}/low-stock`)
      .pipe(map((response) => response.data ?? []));
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

  // HU-16/HU-17: stock that leaves without being sold. A 409 means not enough stock (HU-18)
  addOutput(output: NewOutput) {
    return this.http
      .post<ApiResponse<Output>>(`${this.API_URL}/add-output`, output)
      .pipe(map((response) => response.data as Output));
  }

  // tipo: only 'dano' or only 'uso'; without it, both
  getOutputs(tipo?: OutputTipo) {
    const params: Record<string, string> = tipo ? { tipo } : {};
    return this.http
      .get<ApiResponse<Output[]>>(`${this.API_URL}/outputs`, { params })
      .pipe(map((response) => response.data ?? []));
  }

  // HU-30: user management (owner only)
  getUsers() {
    return this.http
      .get<ApiResponse<User[]>>(`${this.API_URL}/users`)
      .pipe(map((response) => response.data ?? []));
  }

  addUser(user: NewUser) {
    return this.http
      .post<ApiResponse<User>>(`${this.API_URL}/add-user`, user)
      .pipe(map((response) => response.data as User));
  }

  changeUserPassword(id: number, password: string) {
    return this.http
      .put<ApiResponse<User>>(`${this.API_URL}/user-password/${id}`, { password })
      .pipe(map((response) => response.data as User));
  }

  setUserStatus(id: number, activo: boolean) {
    return this.http
      .put<ApiResponse<User>>(`${this.API_URL}/user-status/${id}`, { activo })
      .pipe(map((response) => response.data as User));
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

  // HU-14 (owner only): the entry stays, marked as voided; its stock goes back
  voidEntry(id: number, motivo: string) {
    return this.http
      .put<ApiResponse<Entry>>(`${this.API_URL}/void-entry/${id}`, { motivo })
      .pipe(map((response) => response.data as Entry));
  }

  // HU-14 (owner only): voids the entry and saves the corrected one. Returns the new entry
  correctEntry(id: number, entry: CorrectEntry) {
    return this.http
      .put<ApiResponse<Entry>>(`${this.API_URL}/correct-entry/${id}`, entry)
      .pipe(map((response) => response.data as Entry));
  }

  // HU-20 (owner only): kárdex of one product, newest first, one page at a time
  getProductHistory(id: number, filter: ProductHistoryFilter = {}) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (value != null && value !== '') {
        params[key] = String(value);
      }
    }
    return this.http
      .get<ApiResponse<ProductHistory>>(`${this.API_URL}/product-movements/${id}`, { params })
      .pipe(map((response) => response.data as ProductHistory));
  }

  // HU-26 (owner only): stock × purchase price, per product, per category and in total
  getInventoryValue() {
    return this.http
      .get<ApiResponse<InventoryValue>>(`${this.API_URL}/inventory-value`)
      .pipe(map((response) => response.data as InventoryValue));
  }
}
