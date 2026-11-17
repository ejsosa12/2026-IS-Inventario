import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { CountDetail, CountItem } from '../../models/count';
import { Category, UnidadBase } from '../../models/product';

// HU-32/33/34: physical count ("Conteo físico"). Only one open at a time.
// Step 1 (HU-32): anyone picks categories, starts the count and prints the sheets.
// Step 2 (HU-33): anyone types in what was written on each sheet ("Guardar hoja");
// the owner compares it with the system on counts/compare/:id.
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

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-33: the sheets of the open count (one per category) and the one being typed in
  sheets = computed(() => {
    const groups = new Map<string, CountItem[]>();
    for (const item of this.current()?.items ?? []) {
      const name = item.categoria ?? 'Sin categoría';
      groups.set(name, [...(groups.get(name) ?? []), item]);
    }
    return [...groups].map(([categoria, items]) => ({
      categoria,
      items,
      contados: items.filter((i) => i.contado !== null).length,
    }));
  });
  sheetName = signal<string | null>(null);
  activeSheet = computed(
    () => this.sheets().find((s) => s.categoria === this.sheetName()) ?? this.sheets()[0] ?? null,
  );
  // What is typed and not saved yet, by producto_id. Kept when switching sheets
  drafts = signal<Record<number, string>>({});

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
        this.drafts.set({});
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

  // ---------------- HU-33: type in what was counted ----------------

  draft(item: CountItem): string {
    return this.drafts()[item.producto_id] ?? (item.contado === null ? '' : String(item.contado));
  }

  setDraft(item: CountItem, value: string) {
    this.drafts.update((d) => ({ ...d, [item.producto_id]: value }));
  }

  // '' = not counted (null). Accepts a comma as decimal point ("2,5"). NaN = not a number
  private parse(text: string): number | null {
    const clean = text.trim().replace(',', '.');
    return clean === '' ? null : Number(clean);
  }

  // Same rules as Flask: 0 or more, at most 3 decimals, whole for unidad (HU-07)
  problem(item: CountItem): string | null {
    const value = this.parse(this.draft(item));
    if (value === null) {
      return null;
    }
    if (!Number.isFinite(value)) {
      return 'Escriba un número';
    }
    if (value < 0) {
      return 'No puede ser negativo';
    }
    if (item.unidad_base === 'unidad' && !Number.isInteger(value)) {
      return 'Solo números enteros';
    }
    if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) {
      return 'Máximo 3 decimales';
    }
    return null;
  }

  // Typed and different from what is saved
  private changed(item: CountItem): boolean {
    return this.parse(this.draft(item)) !== item.contado;
  }

  dirty(items: CountItem[]): number {
    return items.filter((i) => this.changed(i)).length;
  }

  hasProblems(items: CountItem[]): boolean {
    return items.some((i) => this.problem(i) !== null);
  }

  pickSheet(name: string) {
    this.sheetName.set(name);
  }

  saveSheet() {
    const count = this.current();
    const sheet = this.activeSheet();
    if (!count || !sheet || this.saving() || this.hasProblems(sheet.items)) {
      return;
    }
    const items = sheet.items
      .filter((i) => this.changed(i))
      .map((i) => ({ producto_id: i.producto_id, contado: this.parse(this.draft(i)) }));
    if (!items.length) {
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.saving.set(true);
    this.dataServices.saveCountItems(count.id, items).subscribe({
      next: (detail) => {
        this.saving.set(false);
        this.current.set(detail);
        // Saved: what is on screen is now what Flask has
        this.drafts.update((d) => {
          const next = { ...d };
          for (const item of sheet.items) {
            delete next[item.producto_id];
          }
          return next;
        });
        this.notice.set(
          `Hoja "${sheet.categoria}" guardada (${items.length} ${items.length === 1 ? 'producto' : 'productos'})`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 400 && err.error?.message === 'count is not open') {
          this.error.set('Este conteo ya se cerró; lo anotado no se guardó');
          this.drafts.set({});
          this.load();
        } else if (err.status === 0) {
          this.error.set('No se pudo conectar con el servidor');
        } else {
          this.error.set('No se pudo guardar la hoja');
        }
      },
    });
  }
}
