import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { LowStockItem, UnidadBase } from '../../models/product';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { DashboardActivity, DashboardTopProduct, SalesDay } from '../../models/report';
import { Sale } from '../../models/sale';
import { MovementTipo } from '../../models/movement';
import { MOVEMENT_TYPES } from '../../core/utils/movement-types';
import { SalesChart } from '../sales-chart/sales-chart';

// Columns of "Productos a agotarse" that can be sorted by clicking their title
type LowStockSortKey = 'nombre' | 'categoria' | 'existencia' | 'stock_minimo' | 'faltan' | 'estado';

// sessionStorage key: the user closed the HU-22 notification. AuthService.logout() clears it
const DISMISSED_KEY = 'lowStockDismissed';

// The first page after logging in. HU-22: it says right away what is running out
@Component({
  imports: [RouterLink, DecimalPipe, SalesChart],
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

  // "Ver" of the notification: scrolls down to the "Productos a agotarse" list
  showLowStockList() {
    document.getElementById('low-stock-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // HU-26 money in the store and HU-24 sales chart. Every user sees them here (decided
  // 2026-11-20); the full reports (Análisis) stay owner only. null = loading
  isAdmin = inject(AuthService).isAdmin;
  inventoryValue = signal<number | null>(null);
  readonly chartRanges = [7, 30];
  chartDays = signal(30);
  salesDays = signal<SalesDay[] | null>(null);
  salesError = signal<string | null>(null);

  // The three lists of dashboard-summary (null = loading): most sold of the chart's days,
  // latest sales and latest movements. Every user sees them
  topProducts = signal<DashboardTopProduct[] | null>(null);
  latestSales = signal<Sale[] | null>(null);
  activity = signal<DashboardActivity[] | null>(null);

  constructor() {
    this.loadSummary();
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

  setChartDays(days: number) {
    if (days !== this.chartDays()) {
      this.chartDays.set(days);
      this.loadSummary();
    }
  }

  private loadSummary() {
    this.salesDays.set(null);
    this.topProducts.set(null);
    this.salesError.set(null);
    this.dataServices.getDashboardSummary(this.chartDays()).subscribe({
      next: (summary) => {
        this.inventoryValue.set(summary.dinero_bodega);
        this.salesDays.set(summary.por_dia);
        this.topProducts.set(summary.mas_vendidos);
        this.latestSales.set(summary.ultimas_ventas);
        this.activity.set(summary.ultimos_movimientos);
      },
      error: () => this.salesError.set('No se pudieron cargar las ventas'),
    });
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    const decimals = unidad === 'unidad' ? 0 : 3;
    return `${+value.toFixed(decimals)} ${this.unidadLabel[unidad]}`;
  }

  typeLabel(tipo: MovementTipo): string {
    return MOVEMENT_TYPES[tipo]?.label ?? tipo;
  }

  typeClasses(tipo: MovementTipo): string {
    return MOVEMENT_TYPES[tipo]?.classes ?? 'bg-gray-100 text-gray-800';
  }

  // The sale ticket in a new tab (same as Vender)
  openTicket(id: number) {
    window.open(`/print/sale/${id}`, '_blank');
  }

  saleNumber(id: number): string {
    return String(id).padStart(6, '0');
  }

  // "20/11/2026 09:27", cut from the ISO text by hand (no time zone conversion)
  dateTime(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y} ${iso.slice(11, 16)}`;
  }

  // "hace 5 min", "hace 3 h", "hace 2 días". Flask sends local time without a zone,
  // which new Date() also reads as local time
  ago(iso: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'ayer' : `hace ${days} días`;
  }

  // 1 producto / 5 productos
  plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }
}
