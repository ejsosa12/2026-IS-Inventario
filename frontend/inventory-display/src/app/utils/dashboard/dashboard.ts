import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { LowStockItem, UnidadBase } from '../../models/product';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';

// Columns of "Productos a agotarse" that can be sorted by clicking their title
type LowStockSortKey = 'nombre' | 'categoria' | 'existencia' | 'stock_minimo' | 'faltan' | 'estado';

// sessionStorage key: the user closed the HU-22 notification. AuthService.logout() clears it
const DISMISSED_KEY = 'lowStockDismissed';

// The first page after logging in. HU-22: it says right away what is running out
@Component({
  imports: [RouterLink, DecimalPipe],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private dataServices = inject(DataServices);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-08: "(1.5 cajas)" next to quantities, for products bought in a presentation

  readonly pres = injectPresentations();

  // Out of stock first, then furthest from the minimum (Flask sorts them)
  lowStock = signal<LowStockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  outOfStock = computed(() => this.lowStock().filter((p) => p.agotado).length);

  // HU-05: filter the table by category ('' = all). Options: the categories in the list
  category = signal('');
  categories = computed(() =>
    [...new Set(this.lowStock().map((p) => this.categoryName(p)))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    ),
  );

  // null = Flask's order (out of stock first, then furthest from the minimum)
  sort = signal<SortState<LowStockSortKey> | null>(null);

  // What the table shows. The notification above always counts the whole list
  shown = computed(() => {
    const category = this.category();
    const list = category
      ? this.lowStock().filter((p) => this.categoryName(p) === category)
      : this.lowStock();
    return sortList(list, this.sort(), (item, key) => this.sortValue(item, key));
  });

  sortBy(key: LowStockSortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  sortIcon(key: LowStockSortKey): string {
    return sortIcon(this.sort(), key);
  }

  ariaSort(key: LowStockSortKey) {
    return ariaSort(this.sort(), key);
  }

  categoryName(item: LowStockItem): string {
    return item.categoria ?? 'Sin categoría';
  }

  private sortValue(item: LowStockItem, key: LowStockSortKey): string | number {
    switch (key) {
      case 'categoria':
        return this.categoryName(item);
      case 'estado':
        // Agotado first
        return item.agotado ? 0 : 1;
      default:
        return item[key];
    }
  }

  // The "X" of the notification: stays closed until the user logs out
  dismissed = signal(sessionStorage.getItem(DISMISSED_KEY) === '1');

  dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    this.dismissed.set(true);
  }

  // HU-26: money in the store, only for the owner (HU-29). null = not loaded / not allowed
  isAdmin = inject(AuthService).isAdmin;
  inventoryValue = signal<number | null>(null);

  constructor() {
    if (this.isAdmin()) {
      this.dataServices.getInventoryValue().subscribe({
        next: (report) => this.inventoryValue.set(report.total),
      });
    }
    this.dataServices.getLowStock().subscribe({
      next: (items) => {
        this.lowStock.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo revisar qué se está acabando');
        this.loading.set(false);
      },
    });
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    const decimals = unidad === 'unidad' ? 0 : 3;
    return `${+value.toFixed(decimals)} ${this.unidadLabel[unidad]}`;
  }

  // 1 producto / 5 productos
  plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }
}
