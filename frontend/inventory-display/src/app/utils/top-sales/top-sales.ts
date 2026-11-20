import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { TopSale, TopSalesReport } from '../../models/report';
import { UnidadBase } from '../../models/product';
import { SalesChart } from '../sales-chart/sales-chart';

type Shortcut = 'semana' | 'mes' | '30' | 'todo';
type TopSortKey = 'nombre' | 'categoria' | 'cantidad' | 'ventas' | 'dinero' | 'existencia';

// HU-24 (owner only, adminGuard; the "Más vendidos" tab of Análisis): "Quiero saber qué es lo
// que más sale, para nunca quedarme sin eso". Only sales count (not merma or uso interno).
// Dates live in the URL like Movimientos; with none it opens on this month. Flask sorts by
// quantity sold (decided 2026-11-20, option A); Dinero and Ventas can be sorted with a click.
@Component({
  imports: [RouterLink, DecimalPipe, SalesChart],
  selector: 'app-top-sales',
  templateUrl: './top-sales.html',
})
export class TopSales {
  private dataServices = inject(DataServices);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  // HU-08: "(1.5 cajas)" next to quantities
  readonly pres = injectPresentations();
  readonly shortcuts: { value: Shortcut; label: string }[] = [
    { value: 'semana', label: 'Esta semana' },
    { value: 'mes', label: 'Este mes' },
    { value: '30', label: 'Últimos 30 días' },
    { value: 'todo', label: 'Todo' },
  ];

  report = signal<TopSalesReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // Applied (from the URL)
  desde = signal<string | null>(null);
  hasta = signal<string | null>(null);

  // Typed in the date inputs, applied with "Buscar"
  draftDesde = signal('');
  draftHasta = signal('');
  dateProblem = computed(() => {
    const desde = this.draftDesde();
    const hasta = this.draftHasta();
    return desde && hasta && desde > hasta ? '"Desde" no puede ser después de "Hasta"' : null;
  });

  activeShortcut = computed<Shortcut | null>(() => {
    const desde = this.desde();
    const hasta = this.hasta();
    if (!desde && !hasta) return 'todo';
    if (hasta !== this.today()) return null;
    if (desde === this.monday()) return 'semana';
    if (desde === this.firstOfMonth()) return 'mes';
    if (desde === this.daysAgo(29)) return '30';
    return null;
  });

  // HU-05: category filter ('' = all) and sortable columns (null = Flask's order)
  category = signal('');
  categories = computed(() =>
    [...new Set((this.report()?.productos ?? []).map((p) => this.categoryName(p)))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    ),
  );
  sort = signal<SortState<TopSortKey> | null>(null);

  // Place in the ranking (by quantity sold), kept when sorting or filtering
  rank = computed(
    () => new Map((this.report()?.productos ?? []).map((p, i) => [p.id, i + 1] as const)),
  );

  shown = computed(() => {
    const category = this.category();
    const list = (this.report()?.productos ?? []).filter(
      (p) => !category || this.categoryName(p) === category,
    );
    return sortList(list, this.sort(), (p, key) =>
      key === 'categoria' ? this.categoryName(p) : p[key],
    );
  });

  lowCount = computed(() => (this.report()?.productos ?? []).filter((p) => p.bajo_minimo).length);

  private request?: Subscription;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const desde = this.validDate(params.get('desde'));
      const hasta = this.validDate(params.get('hasta'));
      // Opening the page with no dates: this month
      if (!desde && !hasta && params.get('todo') !== '1') {
        this.go(this.firstOfMonth(), this.today(), true);
        return;
      }
      this.desde.set(desde);
      this.hasta.set(hasta);
      this.draftDesde.set(desde ?? '');
      this.draftHasta.set(hasta ?? '');
      this.load();
    });
  }

  private load() {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.dataServices.getTopSales(this.desde(), this.hasta()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          err.status === 0
            ? 'No se pudo conectar con el servidor'
            : err.status === 400
              ? 'Revise las fechas del filtro'
              : 'No se pudieron cargar las ventas',
        );
      },
    });
  }

  // Changes the URL; the queryParamMap subscription loads the data
  private go(desde: string | null, hasta: string | null, replaceUrl = false) {
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl,
      queryParams: { desde, hasta, todo: !desde && !hasta ? 1 : null },
    });
  }

  search() {
    if (!this.dateProblem()) {
      this.go(this.draftDesde() || null, this.draftHasta() || null);
    }
  }

  useShortcut(shortcut: Shortcut) {
    const ranges: Record<Shortcut, [string | null, string | null]> = {
      semana: [this.monday(), this.today()],
      mes: [this.firstOfMonth(), this.today()],
      '30': [this.daysAgo(29), this.today()],
      todo: [null, null],
    };
    this.go(...ranges[shortcut]);
  }

  sortBy(key: TopSortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  sortIcon(key: TopSortKey): string {
    return sortIcon(this.sort(), key);
  }

  ariaSort(key: TopSortKey) {
    return ariaSort(this.sort(), key);
  }

  categoryName(p: TopSale): string {
    return p.categoria ?? 'Sin categoría';
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    return `${+value.toFixed(unidad === 'unidad' ? 0 : 3)} ${this.unidadLabel[unidad]}`;
  }

  // "2026-11-01" -> "01/11/2026"
  shortDate(iso: string | null): string {
    return iso ? iso.split('-').reverse().join('/') : '';
  }

  private validDate(value: string | null): string | null {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  // Local dates as YYYY-MM-DD (not toISOString, which is UTC)
  private format(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return this.format(d);
  }

  private today(): string {
    return this.daysAgo(0);
  }

  // The week starts on Monday
  private monday(): string {
    return this.daysAgo((new Date().getDay() + 6) % 7);
  }

  private firstOfMonth(): string {
    const d = new Date();
    return this.format(new Date(d.getFullYear(), d.getMonth(), 1));
  }
}
