import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import {
  ADJUSTMENT_REASONS,
  AdjustmentReason,
  CountChangedProduct,
  CountCompareItem,
  CountComparison,
} from '../../models/count';
import { UnidadBase } from '../../models/product';

type SortKey =
  | 'codigo'
  | 'nombre'
  | 'categoria'
  | 'existencia'
  | 'contado'
  | 'diferencia'
  | 'dinero'
  | 'ajuste'
  | 'ajusteDinero';

// What the owner picked for one product: its reason and, for "Otro", the detail
interface Choice {
  motivo: AdjustmentReason | '';
  detalle: string;
}

const DETALLE_MAX = 150;

// HU-33 (owner only, adminGuard): what the system says vs what was counted.
// The system's stock is the one at this moment (decided 2026-11-16), so "Actualizar"
// reloads it if something was sold or received while counting.
// HU-34: the owner ticks the differences to adjust, gives each one a reason and applies;
// that writes ajuste_mas / ajuste_menos movements and closes the count. Products not
// ticked keep the system's stock. A closed count shows what was adjusted.
@Component({
  imports: [RouterLink, DatePipe, DecimalPipe],
  selector: 'app-count-compare',
  styleUrl: './count-compare.css',
  templateUrl: './count-compare.html',
})
export class CountCompare {
  private dataServices = inject(DataServices);

  readonly countId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  // HU-08: "(1.5 cajas)" next to quantities, for products bought in a presentation
  readonly pres = injectPresentations();
  readonly reasons = ADJUSTMENT_REASONS;
  readonly detalleMax = DETALLE_MAX;

  data = signal<CountComparison | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  notice = signal<string | null>(null);
  // HU-34 409: what changed while the owner was reviewing
  changedProducts = signal<CountChangedProduct[]>([]);

  isOpen = computed(() => this.data()?.estado === 'abierto');

  readonly openColumns: { key: SortKey; label: string }[] = [
    { key: 'codigo', label: 'Código' },
    { key: 'nombre', label: 'Producto' },
    { key: 'categoria', label: 'Categoría' },
    { key: 'existencia', label: 'Sistema' },
    { key: 'contado', label: 'Contado' },
    { key: 'diferencia', label: 'Diferencia' },
    { key: 'dinero', label: 'Dinero' },
  ];
  readonly closedColumns: { key: SortKey; label: string }[] = [
    { key: 'codigo', label: 'Código' },
    { key: 'nombre', label: 'Producto' },
    { key: 'categoria', label: 'Categoría' },
    { key: 'contado', label: 'Contado' },
    { key: 'ajuste', label: 'Ajuste' },
    { key: 'ajusteDinero', label: 'Dinero' },
  ];
  columns = computed(() => (this.isOpen() ? this.openColumns : this.closedColumns));

  onlyDifferent = signal(false);
  category = signal('');
  sort = signal<SortState<SortKey> | null>(null);

  categories = computed(() => [
    ...new Set((this.data()?.items ?? []).map((i) => i.categoria ?? 'Sin categoría')),
  ]);

  shown = computed(() => {
    let items = this.data()?.items ?? [];
    if (this.onlyDifferent()) {
      // Open: the ones that do not match. Closed: the ones that were adjusted
      items = items.filter((i) => (this.isOpen() ? this.adjustable(i) : i.ajuste !== null));
    }
    if (this.category()) {
      items = items.filter((i) => (i.categoria ?? 'Sin categoría') === this.category());
    }
    return sortList(items, this.sort(), (item, key) => this.sortValue(item, key));
  });

  // ---------------- HU-34: choosing what to adjust ----------------

  // Ticked products, by producto_id
  choices = signal<Record<number, Choice>>({});
  saving = signal(false);

  adjustableItems = computed(() => (this.data()?.items ?? []).filter((i) => this.adjustable(i)));
  chosenItems = computed(() => this.adjustableItems().filter((i) => this.choices()[i.producto_id]));
  allChosen = computed(
    () =>
      this.adjustableItems().length > 0 &&
      this.chosenItems().length === this.adjustableItems().length,
  );
  // Net money of the ticked adjustments (only the ones with a purchase price)
  chosenMoney = computed(() => this.chosenItems().reduce((sum, i) => sum + (i.dinero ?? 0), 0));
  missingReasons = computed(() => this.chosenItems().filter((i) => this.choiceProblem(i)).length);

  // Closed count: totals of what was applied
  appliedSummary = computed(() => {
    const applied = (this.data()?.items ?? []).filter((i) => i.ajuste);
    const money = applied.map((i) => i.ajuste?.dinero ?? 0);
    const faltante = -money.filter((m) => m < 0).reduce((a, b) => a + b, 0);
    const sobrante = money.filter((m) => m > 0).reduce((a, b) => a + b, 0);
    return { ajustados: applied.length, faltante, sobrante, neto: sobrante - faltante };
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.dataServices.getCountCompare(this.countId).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
        // Keep the ticks only for products that can still be adjusted
        const keep = new Set(data.items.filter((i) => this.adjustable(i)).map((i) => i.producto_id));
        this.choices.update((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => keep.has(Number(id)))),
        );
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          err.status === 404
            ? 'Ese conteo no existe'
            : err.status === 0
              ? 'No se pudo conectar con el servidor'
              : 'No se pudo cargar la comparación',
        );
      },
    });
  }

  // Counted, with a difference, and the count still open
  adjustable(item: CountCompareItem): boolean {
    return this.isOpen() && item.diferencia !== null && item.diferencia !== 0;
  }

  choice(item: CountCompareItem): Choice | undefined {
    return this.choices()[item.producto_id];
  }

  toggleChoice(item: CountCompareItem) {
    this.choices.update((current) => {
      const next = { ...current };
      if (next[item.producto_id]) {
        delete next[item.producto_id];
      } else {
        next[item.producto_id] = { motivo: '', detalle: '' };
      }
      return next;
    });
  }

  toggleAll() {
    if (this.allChosen()) {
      this.choices.set({});
      return;
    }
    this.choices.update((current) => {
      const next = { ...current };
      for (const item of this.adjustableItems()) {
        next[item.producto_id] ??= { motivo: '', detalle: '' };
      }
      return next;
    });
  }

  setReason(item: CountCompareItem, motivo: string) {
    this.updateChoice(item, { motivo: motivo as AdjustmentReason | '' });
  }

  setDetail(item: CountCompareItem, detalle: string) {
    this.updateChoice(item, { detalle });
  }

  private updateChoice(item: CountCompareItem, change: Partial<Choice>) {
    this.choices.update((current) => {
      const choice = current[item.producto_id];
      return choice ? { ...current, [item.producto_id]: { ...choice, ...change } } : current;
    });
  }

  // HU-34: every adjustment needs a reason; "Otro" also needs a short detail
  choiceProblem(item: CountCompareItem): string | null {
    const choice = this.choice(item);
    if (!choice) {
      return null;
    }
    if (!choice.motivo) {
      return 'Elija el motivo';
    }
    if (choice.motivo === 'Otro') {
      const detalle = choice.detalle.trim();
      if (!detalle) {
        return 'Escriba qué pasó';
      }
      if (detalle.length > DETALLE_MAX) {
        return `Máximo ${DETALLE_MAX} caracteres`;
      }
    }
    return null;
  }

  apply() {
    const data = this.data();
    if (!data || !this.isOpen() || this.saving() || this.missingReasons()) {
      return;
    }
    const chosen = this.chosenItems();
    const left = this.adjustableItems().length - chosen.length;
    const lines = [
      chosen.length
        ? `Se van a aplicar ${chosen.length} ${chosen.length === 1 ? 'ajuste' : 'ajustes'} (${this.money(this.chosenMoney())}).`
        : 'No se va a ajustar ningún producto.',
    ];
    if (left) {
      lines.push(
        `${left} ${left === 1 ? 'producto con diferencia se queda' : 'productos con diferencia se quedan'} como dice el sistema.`,
      );
    }
    lines.push(`El conteo #${data.id} se cierra y ya no se puede cambiar. ¿Continuar?`);
    if (!confirm(lines.join('\n\n'))) {
      return;
    }

    this.error.set(null);
    this.notice.set(null);
    this.changedProducts.set([]);
    this.saving.set(true);
    const ajustes = chosen.map((item) => {
      const choice = this.choice(item)!;
      return {
        producto_id: item.producto_id,
        motivo: choice.motivo as AdjustmentReason,
        detalle: choice.motivo === 'Otro' ? choice.detalle.trim() : undefined,
        diferencia: item.diferencia!,
      };
    });
    this.dataServices.applyCount(data.id, ajustes).subscribe({
      next: (count) => {
        this.saving.set(false);
        this.choices.set({});
        this.sort.set(null);
        this.notice.set(
          `Conteo #${count.id} aplicado con ${count.ajustes} ${count.ajustes === 1 ? 'ajuste' : 'ajustes'}. La existencia ya quedó igual a lo contado`,
        );
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) {
          // Stock or a sheet changed meanwhile: show the new numbers and let them review
          this.changedProducts.set(err.error?.data?.productos ?? []);
          this.error.set('Mientras revisaba cambió la existencia o lo contado. Revise de nuevo');
          this.load();
        } else if (err.status === 400 && err.error?.message === 'count is not open') {
          this.error.set('Este conteo ya se cerró');
          this.load();
        } else if (err.status === 403) {
          this.error.set('Solo el dueño puede aplicar ajustes');
        } else if (err.status === 0) {
          this.error.set('No se pudo conectar con el servidor');
        } else {
          this.error.set('No se pudieron aplicar los ajustes');
        }
      },
    });
  }

  // ---------------- display ----------------

  private sortValue(item: CountCompareItem, key: SortKey): string | number | null {
    if (key === 'ajuste') {
      return item.ajuste?.cantidad ?? null;
    }
    if (key === 'ajusteDinero') {
      return item.ajuste?.dinero ?? null;
    }
    return item[key];
  }

  sortBy(key: SortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  icon(key: SortKey) {
    return sortIcon(this.sort(), key);
  }

  aria(key: SortKey) {
    return ariaSort(this.sort(), key);
  }

  setCategory(value: string) {
    this.category.set(value);
  }

  // "+3 u", "−97.5 lb", "0 lb"
  signed(value: number, unidad: UnidadBase): string {
    const amount = +Math.abs(value).toFixed(3);
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${amount.toLocaleString('es-GT', { maximumFractionDigits: 3 })} ${this.unidadLabel[unidad]}`;
  }

  quantity(value: number, unidad: UnidadBase): string {
    return `${(+value.toFixed(3)).toLocaleString('es-GT', { maximumFractionDigits: 3 })} ${this.unidadLabel[unidad]}`;
  }

  // "+Q0.75", "−Q6.83", "Q0.00"
  money(value: number): string {
    const sign = value > 0.004 ? '+' : value < -0.004 ? '−' : '';
    return `${sign}Q${Math.abs(value).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  signClass(value: number | null | undefined): string {
    if (!value) {
      return 'text-gray-500';
    }
    return value < 0 ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold';
  }
}
