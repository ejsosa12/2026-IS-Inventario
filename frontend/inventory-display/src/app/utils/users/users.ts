import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { User } from '../../models/user';
import { PASSWORD_MIN } from '../add-user/add-user';

// HU-30: the owner sees every user, changes passwords and gives or takes away access
@Component({
  imports: [RouterLink, ReactiveFormsModule],
  selector: 'app-users',
  templateUrl: './users.html',
})
export class Users {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  // The logged-in owner: cannot deactivate themselves
  readonly myEmail = inject(AuthService).email;
  readonly passwordMin = PASSWORD_MIN;

  users = signal<User[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  // The user being activated/deactivated right now (disables its button)
  busyId = signal<number | null>(null);
  actionError = signal<string | null>(null);
  actionDone = signal<string | null>(null);

  // "Cambiar contraseña" window: the user it is open for (null = closed)
  passwordFor = signal<User | null>(null);
  savingPassword = signal(false);
  passwordError = signal<string | null>(null);

  passwordForm = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(100)]],
    confirm: ['', Validators.required],
  });

  // Same search as suppliers: every word must appear in the name, email or role
  filtered = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return this.users();
    }
    return this.users().filter((user) => {
      const text = this.normalize(`${user.nombre} ${user.email} ${this.rolLabel(user)}`);
      return words.every((word) => text.includes(word));
    });
  });

  constructor() {
    this.dataServices.getUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los usuarios');
        this.loading.set(false);
      },
    });
  }

  rolLabel(user: User): string {
    return user.rol === 'admin' ? 'Dueño' : 'Empleado';
  }

  isMe(user: User): boolean {
    return user.email === this.myEmail();
  }

  // HU-30: a deactivated user cannot log in, but their movements stay
  toggleActive(user: User) {
    const activo = !user.activo;
    if (!activo && !confirm(`¿Desactivar a ${user.nombre}? Ya no podrá entrar al sistema.`)) {
      return;
    }
    this.actionError.set(null);
    this.actionDone.set(null);
    this.busyId.set(user.id);
    this.dataServices.setUserStatus(user.id, activo).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.busyId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(err.error?.message === 'you cannot deactivate yourself'
          ? 'No puede desactivar su propio usuario'
          : 'No se pudo cambiar el estado del usuario');
        this.busyId.set(null);
      },
    });
  }

  openPassword(user: User) {
    this.passwordForm.reset();
    this.passwordError.set(null);
    this.actionDone.set(null);
    this.passwordFor.set(user);
  }

  closePassword() {
    this.passwordFor.set(null);
  }

  invalidPassword(field: keyof typeof this.passwordForm.controls): boolean {
    const control = this.passwordForm.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  get passwordsDiffer(): boolean {
    const { password, confirm } = this.passwordForm.getRawValue();
    return !!confirm && password !== confirm;
  }

  savePassword() {
    const user = this.passwordFor();
    if (!user) {
      return;
    }
    this.passwordError.set(null);
    if (this.passwordForm.invalid || this.passwordsDiffer) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.savingPassword.set(true);
    this.dataServices.changeUserPassword(user.id, this.passwordForm.getRawValue().password!).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.passwordFor.set(null);
        this.actionDone.set(`Contraseña de ${user.nombre} cambiada`);
      },
      error: (err: HttpErrorResponse) => {
        this.savingPassword.set(false);
        this.passwordError.set(err.status === 0
          ? 'No se pudo conectar con el servidor'
          : 'No se pudo cambiar la contraseña');
      },
    });
  }

  private replace(updated: User) {
    this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
  }

  // "José SOSA" -> "jose sosa"
  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
