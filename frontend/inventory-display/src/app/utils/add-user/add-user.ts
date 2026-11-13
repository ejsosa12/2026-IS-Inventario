import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { Rol } from '../../core/services/auth-service';
import { NewUser } from '../../models/user';

// Same minimum Flask checks in backend/app/users/users.py
export const PASSWORD_MIN = 6;

// HU-30: the owner creates a user and gives them a role (it cannot be changed later)
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-add-user',
  templateUrl: './add-user.html',
})
export class AddUser {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  readonly passwordMin = PASSWORD_MIN;

  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  form = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(50)]],
    rol: ['employee' as Rol, Validators.required],
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(100)]],
    confirm: ['', Validators.required],
  });

  // Shows the red message only after the user touched the field
  invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  get passwordsDiffer(): boolean {
    const { password, confirm } = this.form.getRawValue();
    return !!confirm && password !== confirm;
  }

  save() {
    this.error.set(null);
    this.created.set(null);

    if (this.form.invalid || this.passwordsDiffer) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const user: NewUser = {
      nombre: value.nombre!.trim(),
      email: value.email!.trim().toLowerCase(),
      rol: value.rol!,
      password: value.password!,
    };

    this.saving.set(true);
    this.dataServices.addUser(user).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.created.set(`${created.nombre} (${created.rol === 'admin' ? 'Dueño' : 'Empleado'})`);
        this.form.reset({ rol: 'employee' });
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
        return 'Solo el dueño puede agregar usuarios';
      case 409:
        return 'Ya existe un usuario con ese correo';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar el usuario';
    }
  }
}
