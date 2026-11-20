import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { StaleProduct, StaleProductsReport } from '../../models/report';
import { UnidadBase } from '../../models/product';

type StaleSortKey = 'nombre' | 'categoria' | 'existencia' | 'dias_sin_vender' | 'dinero';

// HU-25 (owner only, adminGuard; the "No se mueve" tab of Análisis): "Tengo una pintura que
// ahí está juntando polvo. Quiero ver todo lo que está así, para ya no comprarlo".
// Products with stock and no sale in the last 30/60/90 days (?dias= in the URL, default 90).
// Products that arrived less than that ago are left out, and the most money first
// (both decided 2026-11-20, option A). The money is at purchase price, like HU-26.
@Component({
  imports: [RouterLink, DecimalPipe],
  selector: 'app-stale-products',
  templateUrl: './stale-products.html',
})
export class StaleProducts {
  private dataServices = inject(DataServices);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly options = [30, 60, 90];
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  // HU-08: "(1.5 cajas)" next to quantities
  readonly pres = injectPresentations();

  report = signal<StaleProductsReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  dias = signal(90);

  // HU-05: category filter ('' = all) and sortable columns (null = Flask's order: most money)
  category = signal('');
  categories = computed(() =>
    [...new Set((this.report()?.productos ?? []).map((p) => this.categoryName(p)))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    ),
  );
  sort = signal<SortState<StaleSortKey> | null>(null);

  shown = computed(() => {
    const category = this.category();
    const list = (this.report()?.productos ?? []).filter(
      (p) => !category || this.categoryName(p) === category,
    );
    return sortList(list, this.sort(), (p, key) =>
      key === 'categoria' ? this.categoryName(p) : p[key],
    );
  });

  // Products with stock but no purchase price: their money cannot be counted (like HU-26)
  withoutPrice = computed(() => (this.report()?.productos ?? []).filter((p) => p.dinero === null));

  private request?: Subscription;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const dias = Number(params.get('dias'));
      this.dias.set(this.options.includes(dias) ? dias : 90);
      this.load();
    });
  }

  private load() {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.dataServices.getStaleProducts(this.dias()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          err.status === 0
            ? 'No se pudo conectar con el servidor'
            : 'No se pudieron cargar los productos sin movimiento',
        );
      },
    });
  }

  // Changes the URL; the queryParamMap subscription loads the data
  setDias(dias: number) {
    if (dias !== this.dias()) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { dias } });
    }
  }

  sortBy(key: StaleSortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  sortIcon(key: StaleSortKey): string {
    return sortIcon(this.sort(), key);
  }

  ariaSort(key: StaleSortKey) {
    return ariaSort(this.sort(), key);
  }

  categoryName(p: StaleProduct): string {
    return p.categoria ?? 'Sin categoría';
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    return `${+value.toFixed(unidad === 'unidad' ? 0 : 3)} ${this.unidadLabel[unidad]}`;
  }

  // "2026-11-01" -> "01/11/2026" by hand (new Date('2026-11-01') is UTC)
  shortDate(iso: string | null): string {
    return iso ? iso.split('-').reverse().join('/') : '';
  }
}
