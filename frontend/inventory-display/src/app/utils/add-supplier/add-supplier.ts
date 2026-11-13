import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { NewSupplier } from '../../models/supplier';

// Used by two routes: suppliers/add-supplier (create) and suppliers/edit-supplier/:id (HU-09 edit)
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-add-supplier',
  templateUrl: './add-supplier.html',
})
export class AddSupplier {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);
  private router = inject(Router);

  // null = creating a new supplier
  readonly editId: number | null = (() => {
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id');
    return id ? Number(id) : null;
  })();

  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  form = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    telefono: ['', Validators.maxLength(20)],
    contacto: ['', Validators.maxLength(100)],
    nit: ['', Validators.maxLength(20)],
  });

  constructor() {
    if (this.editId !== null) {
      this.loading.set(true);
      this.dataServices.getSupplier(this.editId).subscribe({
        next: (supplier) => {
          this.form.setValue({
            nombre: supplier.nombre,
            telefono: supplier.telefono ?? '',
            contacto: supplier.contacto ?? '',
            nit: supplier.nit ?? '',
          });
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(
            err.status === 404 ? 'Ese proveedor no existe' : 'No se pudo cargar el proveedor',
          );
          this.loading.set(false);
        },
      });
    }
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
    const supplier: NewSupplier = {
      nombre: value.nombre!.trim(),
      telefono: value.telefono?.trim() || null,
      contacto: value.contacto?.trim() || null,
      // Empty NIT goes as null: the column is UNIQUE and only NULL can repeat
      nit: value.nit?.trim().toUpperCase() || null,
    };

    this.saving.set(true);
    const request =
      this.editId === null
        ? this.dataServices.addSupplier(supplier)
        : this.dataServices.editSupplier(this.editId, supplier);

    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        if (this.editId !== null) {
          // Edited: back to the list, where the change shows
          this.router.navigate(['/content/suppliers']);
          return;
        }
        this.created.set(saved.nombre);
        this.form.reset();
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
        return 'Solo el dueño puede agregar o editar proveedores';
      case 404:
        return 'Ese proveedor no existe';
      case 409:
        return 'Ya existe un proveedor con ese NIT';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar el proveedor';
    }
  }
}
