import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { CountCompareItem, CountComparison } from '../../models/count';
import { UnidadBase } from '../../models/product';

type SortKey = 'codigo' | 'nombre' | 'categoria' | 'existencia' | 'contado' | 'diferencia' | 'dinero';

// HU-33 (owner only, adminGuard): what the system says vs what was counted.
// The system's stock is the one at this moment (decided 2026-11-16), so "Actualizar"
// reloads it if something was sold or received while counting.
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

  readonly columns: { key: SortKey; label: string }[] = [
    { key: 'codigo', label: 'Código' },
    { key: 'nombre', label: 'Producto' },
    { key: 'categoria', label: 'Categoría' },
    { key: 'existencia', label: 'Sistema' },
    { key: 'contado', label: 'Contado' },
    { key: 'diferencia', label: 'Diferencia' },
    { key: 'dinero', label: 'Dinero' },
  ];

  data = signal<CountComparison | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  onlyDifferent = signal(false);
  category = signal('');
  sort = signal<SortState<SortKey> | null>(null);

  categories = computed(() => [
    ...new Set((this.data()?.items ?? []).map((i) => i.categoria ?? 'Sin categoría')),
  ]);

  shown = computed(() => {
    let items = this.data()?.items ?? [];
    if (this.onlyDifferent()) {
      items = items.filter((i) => i.diferencia !== null && i.diferencia !== 0);
    }
    if (this.category()) {
      items = items.filter((i) => (i.categoria ?? 'Sin categoría') === this.category());
    }
    return sortList(items, this.sort(), (item, key) => this.sortValue(item, key));
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

  // Every column sorts by the field of the same name; "Sin contar" (null) goes last
  private sortValue(item: CountCompareItem, key: SortKey): string | number | null {
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

  differenceClass(item: CountCompareItem): string {
    if (item.diferencia === null || item.diferencia === 0) {
      return 'text-gray-500';
    }
    return item.diferencia < 0 ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold';
  }
}
