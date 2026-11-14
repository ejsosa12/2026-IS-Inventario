import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { Category, EditProductRequest, ProductDetail, UnidadBase } from '../../models/product';

// HU-21: change the minimum of a product that already exists.
// HU-02: change the sale and purchase price, keeping who/when/previous price (price_history).
// Owner only (adminGuard + Flask 403). Presentations are only shown, not changed here.
@Component({
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe, DatePipe],
  selector: 'app-edit-product',
  templateUrl: './edit-product.html',
})
export class EditProduct {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  readonly productId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));

  readonly unidades: { value: UnidadBase; label: string }[] = [
    { value: 'unidad', label: 'Unidad' },
    { value: 'lb', label: 'Libra (lb)' },
    { value: 'm', label: 'Metro (m)' },
    { value: 'gal', label: 'Galón (gal)' },
  ];
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  product = signal<ProductDetail | null>(null);
  categories = signal<Category[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  saved = signal<string | null>(null);

  form = this.fb.group({
    codigo: ['', [Validators.required, Validators.maxLength(30)]],
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    categoria_id: [null as number | null],
    unidad_base: ['unidad' as UnidadBase, Validators.required],
    stock_minimo: [null as number | null, Validators.min(0)],
    precio: [null as number | null, [Validators.required, Validators.min(0)]],
    precio_compra: [null as number | null, Validators.min(0)],
  });

  constructor() {
    this.dataServices.getCategories().subscribe({
      next: (categories) => this.categories.set(categories),
    });
    this.dataServices.getProduct(this.productId).subscribe({
      next: (product) => {
        this.fill(product);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.status === 404 ? 'Ese producto no existe' : 'No se pudo cargar el producto');
        this.loading.set(false);
      },
    });
  }

  // Puts the product in the form (also after saving, so the history is up to date)
  private fill(product: ProductDetail) {
    this.product.set(product);
    this.form.reset({
      codigo: product.codigo,
      nombre: product.nombre,
      categoria_id: product.categoria_id,
      unidad_base: product.unidad_base,
      stock_minimo: product.stock_minimo,
      precio: product.precio,
      precio_compra: product.precio_compra,
    });
    // 50 lb already entered would become "50 unidades": the unit is locked once it moved
    if (product.tiene_movimientos) {
      this.form.controls.unidad_base.disable();
    } else {
      this.form.controls.unidad_base.enable();
    }
  }

  get unidad(): string {
    return this.unidadLabel[this.form.controls.unidad_base.value ?? 'unidad'];
  }

  get stockStep(): string {
    return this.form.controls.unidad_base.value === 'unidad' ? '1' : '0.01';
  }

  // HU-02: "Gana Q10.00 por u (11.8 %)" or the warning when it sells below cost
  get margin(): { amount: number; percent: number | null } | null {
    const { precio, precio_compra } = this.form.getRawValue();
    if (precio == null || precio_compra == null) {
      return null;
    }
    const amount = precio - precio_compra;
    return { amount, percent: precio > 0 ? (amount / precio) * 100 : null };
  }

  invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  save() {
    this.error.set(null);
    this.saved.set(null);

    const product = this.product();
    if (!product) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    // HU-07: products sold by unit only take whole minimums
    if (
      value.unidad_base === 'unidad' &&
      value.stock_minimo != null &&
      !Number.isInteger(value.stock_minimo)
    ) {
      this.error.set('Este producto es por unidad: el mínimo debe ser un número entero');
      return;
    }
    // Flask keeps it once the product has one (an invoice set it)
    if (value.precio_compra == null && product.precio_compra != null) {
      this.error.set('El precio de compra no se puede dejar vacío');
      return;
    }
    // HU-02: warn before saving if it sells below what it costs
    if (value.precio_compra != null && value.precio! < value.precio_compra) {
      const ok = confirm(
        `Está vendiendo a Q${value.precio!.toFixed(2)} algo que le cuesta ` +
          `Q${value.precio_compra.toFixed(2)} por ${this.unidad}. ¿Guardar de todas formas?`,
      );
      if (!ok) {
        return;
      }
    }

    const request: EditProductRequest = {
      codigo: value.codigo!.trim(),
      nombre: value.nombre!.trim(),
      categoria_id: value.categoria_id ?? null,
      unidad_base: value.unidad_base!,
      stock_minimo: value.stock_minimo ?? null,
      precio: value.precio!,
      precio_compra: value.precio_compra ?? null,
    };

    this.saving.set(true);
    this.dataServices.editProduct(this.productId, request).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.fill(updated);
        this.saved.set(`Cambios guardados: ${updated.nombre}`);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'No se pudo conectar con el servidor';
      case 403:
        return 'Solo el dueño puede editar productos y cambiar precios';
      case 404:
        return 'Ese producto ya no existe';
      case 409:
        return 'Ya existe otro producto con ese código';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar el producto';
    }
  }
}
