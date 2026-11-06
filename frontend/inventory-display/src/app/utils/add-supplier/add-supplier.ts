import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { NewSupplier } from '../../models/supplier';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-add-supplier',
  templateUrl: './add-supplier.html',
})
export class AddSupplier {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  form = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    telefono: ['', Validators.maxLength(20)],
    nit: ['', Validators.maxLength(20)],
  });

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
      // Empty NIT goes as null: the column is UNIQUE and only NULL can repeat
      nit: value.nit?.trim().toUpperCase() || null,
    };

    this.saving.set(true);
    this.dataServices.addSupplier(supplier).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.created.set(created.nombre);
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
        return 'Solo el dueño puede agregar proveedores';
      case 409:
        return 'Ya existe un proveedor con ese NIT';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar el proveedor';
    }
  }
}
