import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DataServices } from '../../core/services/data-services';
import { Category } from '../../models/product';

// HU-05: the owner creates, renames and deactivates categories (route guarded by adminGuard)
@Component({
  imports: [],
  selector: 'app-categories',
  templateUrl: './categories.html',
})
export class Categories {
  private dataServices = inject(DataServices);

  readonly NOMBRE_MAX = 50;

  categories = signal<Category[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  // "Nueva categoría"
  newName = signal('');
  saving = signal(false);
  created = signal<string | null>(null);

  // Row being renamed (inline) and its text
  editingId = signal<number | null>(null);
  editName = signal('');

  // Row waiting for Flask (rename or activate/deactivate)
  busyId = signal<number | null>(null);
  actionError = signal<string | null>(null);

  // Same search as the other lists: every typed word must appear in the name
  filtered = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    return this.categories().filter((category) => {
      const text = this.normalize(category.nombre);
      return words.every((word) => text.includes(word));
    });
  });

  constructor() {
    this.dataServices.getCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las categorías');
        this.loading.set(false);
      },
    });
  }

  // Same rules Flask checks: required, max 50, not used by another category.
  // Returns the message to show, or null when the name is fine
  nameProblem(nombre: string, exceptId: number | null = null): string | null {
    const cleaned = this.clean(nombre);
    if (!cleaned) {
      return 'Escribí el nombre';
    }
    if (cleaned.length > this.NOMBRE_MAX) {
      return `Máximo ${this.NOMBRE_MAX} caracteres`;
    }
    const taken = this.categories().some(
      (c) => c.id !== exceptId && this.normalize(c.nombre) === this.normalize(cleaned),
    );
    return taken ? 'Ya existe una categoría con ese nombre' : null;
  }

  add() {
    const nombre = this.clean(this.newName());
    this.created.set(null);
    this.actionError.set(null);
    if (this.saving() || this.nameProblem(nombre)) {
      return;
    }
    this.saving.set(true);
    this.dataServices.addCategory(nombre).subscribe({
      next: (category) => {
        this.categories.update((list) => this.sorted([...list, category]));
        this.newName.set('');
        this.created.set(`Categoría "${category.nombre}" creada`);
        this.saving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(this.errorMessage(err, 'No se pudo crear la categoría'));
        this.saving.set(false);
      },
    });
  }

  startRename(category: Category) {
    this.actionError.set(null);
    this.created.set(null);
    this.editingId.set(category.id);
    this.editName.set(category.nombre);
  }

  cancelRename() {
    this.editingId.set(null);
  }

  saveRename(category: Category) {
    const nombre = this.clean(this.editName());
    if (nombre === category.nombre) {
      this.cancelRename();
      return;
    }
    if (this.busyId() !== null || this.nameProblem(nombre, category.id)) {
      return;
    }
    this.actionError.set(null);
    this.busyId.set(category.id);
    this.dataServices.editCategory(category.id, nombre).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.editingId.set(null);
        this.busyId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(this.errorMessage(err, 'No se pudo renombrar la categoría'));
        this.busyId.set(null);
      },
    });
  }

  // Deactivate (asks first) or reactivate. Its products keep it either way
  toggleActive(category: Category) {
    const activo = !category.activo;
    if (
      !activo &&
      !confirm(
        `¿Desactivar "${category.nombre}"? Sus ${category.productos} productos la conservan, ` +
          'pero ya no se podrá elegir para productos nuevos.',
      )
    ) {
      return;
    }
    this.actionError.set(null);
    this.created.set(null);
    this.busyId.set(category.id);
    this.dataServices.setCategoryStatus(category.id, activo).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.busyId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(
          this.errorMessage(err, 'No se pudo cambiar el estado de la categoría'),
        );
        this.busyId.set(null);
      },
    });
  }

  private replace(updated: Category) {
    this.categories.update((list) =>
      this.sorted(list.map((c) => (c.id === updated.id ? updated : c))),
    );
  }

  private sorted(list: Category[]): Category[] {
    return [...list].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  private errorMessage(err: HttpErrorResponse, fallback: string): string {
    switch (err.status) {
      case 0:
        return 'No se pudo conectar con el servidor';
      case 403:
        return 'Solo el dueño puede cambiar las categorías';
      case 404:
        return 'Esa categoría ya no existe';
      case 409:
        return 'Ya existe una categoría con ese nombre';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return fallback;
    }
  }

  // Same cleanup Flask does: "  Pintura   y barniz " -> "Pintura y barniz"
  private clean(nombre: string): string {
    return nombre.trim().replace(/\s+/g, ' ');
  }

  // "Plomería" -> "plomeria"
  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
