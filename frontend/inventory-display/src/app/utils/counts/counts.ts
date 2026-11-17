import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { CountDetail } from '../../models/count';
import { Category } from '../../models/product';

// HU-32/33/34: physical count ("Conteo físico"). Only one open at a time.
// Step 1 (HU-32): anyone picks categories, starts the count and prints the sheets.
// The owner can cancel a count started by mistake.
@Component({
  imports: [RouterLink, DatePipe],
  selector: 'app-counts',
  templateUrl: './counts.html',
})
export class Counts {
  private dataServices = inject(DataServices);
  isAdmin = inject(AuthService).isAdmin;

  // The open count with its products, or null when there is none
  current = signal<CountDetail | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  notice = signal<string | null>(null);

  categories = signal<Category[]>([]);
  // Only categories that have products can be counted
  countable = computed(() => this.categories().filter((c) => c.productos > 0));
  selected = signal<Set<number>>(new Set());
  allSelected = computed(
    () => this.countable().length > 0 && this.selected().size === this.countable().length,
  );

  saving = signal(false);

  // "3 de Clavos y tornillos · 4 de Herramientas"
  perCategory = computed(() => {
    const totals = new Map<string, number>();
    for (const item of this.current()?.items ?? []) {
      const name = item.categoria ?? 'Sin categoría';
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    return [...totals].map(([name, productos]) => ({ name, productos }));
  });

  constructor() {
    this.dataServices.getCategories().subscribe({
      next: (categories) => this.categories.set(categories),
    });
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.dataServices.getCurrentCount().subscribe({
      next: (count) => {
        if (!count) {
          this.current.set(null);
          this.loading.set(false);
          return;
        }
        // The products are needed for the categories of the count
        this.dataServices.getCount(count.id).subscribe({
          next: (detail) => {
            this.current.set(detail);
            this.loading.set(false);
          },
          error: () => this.failed('No se pudo cargar el conteo'),
        });
      },
      error: (err: HttpErrorResponse) =>
        this.failed(
          err.status === 0 ? 'No se pudo conectar con el servidor' : 'No se pudo cargar el conteo',
        ),
    });
  }

  private failed(message: string) {
    this.error.set(message);
    this.loading.set(false);
  }

  toggle(id: number) {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  toggleAll() {
    this.selected.set(
      this.allSelected() ? new Set() : new Set(this.countable().map((c) => c.id)),
    );
  }

  start() {
    if (!this.selected().size || this.saving()) {
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.saving.set(true);
    this.dataServices.addCount([...this.selected()]).subscribe({
      next: (count) => {
        this.saving.set(false);
        this.selected.set(new Set());
        this.current.set(count);
        this.notice.set(`Conteo #${count.id} iniciado. Ya puede imprimir las hojas`);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) {
          // Someone else started one meanwhile: show it
          this.error.set('Ya hay un conteo abierto. Termine ese antes de iniciar otro');
          this.load();
        } else if (err.status === 0) {
          this.error.set('No se pudo conectar con el servidor');
        } else {
          this.error.set('No se pudo iniciar el conteo');
        }
      },
    });
  }

  cancel() {
    const count = this.current();
    if (!count || this.saving()) {
      return;
    }
    if (!confirm(`¿Cancelar el conteo #${count.id}? Lo que se haya anotado no se va a usar.`)) {
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.saving.set(true);
    this.dataServices.cancelCount(count.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.current.set(null);
        this.notice.set(`Conteo #${count.id} cancelado`);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(
          err.status === 403
            ? 'Solo el dueño puede cancelar un conteo'
            : 'No se pudo cancelar el conteo',
        );
        this.load();
      },
    });
  }
}
