import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map } from 'rxjs';
import { ApiResponse, Category, NewProduct, Product, ProductListItem } from '../../models/product';
import { NewSupplier, Supplier } from '../../models/supplier';

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
}
