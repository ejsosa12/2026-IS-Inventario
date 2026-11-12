import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { Category, NewPresentation, NewProduct, UnidadBase } from '../../models/product';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-add-product',
  templateUrl: './add-product.html',
})
export class AddProduct {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  readonly unidades: { value: UnidadBase; label: string }[] = [
    { value: 'unidad', label: 'Unidad' },
    { value: 'lb', label: 'Libra (lb)' },
    { value: 'm', label: 'Metro (m)' },
  ];

  categories = signal<Category[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  // Plural names for the "1 caja = 50 lb" hint
  private readonly unidadPlural: Record<UnidadBase, string> = { unidad: 'unidades', lb: 'lb', m: 'm' };

  // HU-06: one row of "Se compra en"
  private presentationGroup() {
    return this.fb.group({
      nombre: ['', [Validators.required, Validators.maxLength(30)]],
      factor: [null as number | null, [Validators.required, Validators.min(0.001)]],
    });
  }

  form = this.fb.group({
    codigo: ['', [Validators.required, Validators.maxLength(30)]],
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    precio: [null as number | null, [Validators.required, Validators.min(0)]],
    unidad_base: ['unidad' as UnidadBase, Validators.required],
    stock_minimo: [null as number | null, Validators.min(0)],
    categoria_id: [null as number | null],
    presentaciones: this.fb.array<ReturnType<AddProduct['presentationGroup']>>([]),
  });

  get presentations() {
    return this.form.controls.presentaciones;
  }

  addPresentation() {
    this.presentations.push(this.presentationGroup());
  }

  removePresentation(index: number) {
    this.presentations.removeAt(index);
  }

  // "1 caja = 50 lb" next to each row
  equivalence(index: number): string | null {
    const { nombre, factor } = this.presentations.at(index).getRawValue();
    if (!factor || factor <= 0) {
      return null;
    }
    const unidad = this.form.controls.unidad_base.value ?? 'unidad';
    return `1 ${nombre?.trim() || 'presentación'} = ${factor} ${this.unidadPlural[unidad]}`;
  }

  presentationInvalid(index: number, field: 'nombre' | 'factor'): boolean {
    const control = this.presentations.at(index).controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  constructor() {
    this.dataServices.getCategories().subscribe({
      next: (categories) => this.categories.set(categories),
      error: () => this.error.set('No se pudieron cargar las categorías'),
    });
  }

  // HU-07: by unit only whole numbers, by lb or m decimals are allowed
  get stockStep(): string {
    return this.form.controls.unidad_base.value === 'unidad' ? '1' : '0.01';
  }

  // Shows the red message only after the user touched the field
  invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  save() {
    this.error.set(null);
    this.created.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();

    // HU-07: same rule Flask checks, but here the user sees it right away
    if (value.unidad_base === 'unidad' && value.stock_minimo != null && !Number.isInteger(value.stock_minimo)) {
      this.error.set('Para productos por unidad el stock mínimo debe ser un número entero');
      return;
    }

    // HU-06: same rules Flask checks, but here the user sees them right away
    const presentaciones: NewPresentation[] = value.presentaciones.map((p) => ({
      nombre: p.nombre!.trim(),
      factor: p.factor!,
    }));
    const names = presentaciones.map((p) => p.nombre.toLowerCase());
    if (new Set(names).size !== names.length) {
      this.error.set('Hay dos presentaciones con el mismo nombre');
      return;
    }
    if (value.unidad_base === 'unidad' && presentaciones.some((p) => !Number.isInteger(p.factor))) {
      this.error.set('Para productos por unidad, cada presentación debe traer un número entero de unidades');
      return;
    }

    const product: NewProduct = {
      codigo: value.codigo!.trim(),
      nombre: value.nombre!.trim(),
      precio: value.precio!,
      unidad_base: value.unidad_base!,
      stock_minimo: value.stock_minimo ?? null,
      categoria_id: value.categoria_id ?? null,
      presentaciones,
    };

    this.saving.set(true);
    this.dataServices.addProduct(product).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.created.set(`${created.codigo} · ${created.nombre}`);
        this.form.reset({ unidad_base: 'unidad' });
        this.presentations.clear();
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
        return 'Solo el dueño puede agregar productos';
      case 409:
        return 'Ya existe un producto con ese código';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar el producto';
    }
  }
}
