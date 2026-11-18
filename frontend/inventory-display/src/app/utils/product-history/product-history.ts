import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataServices } from '../../core/services/data-services';
import { MOVEMENT_TYPES } from '../../core/utils/movement-types';
import {
  ProductHistory as History,
  ProductMovement,
} from '../../models/movement';
import { UnidadBase } from '../../models/product';
import { SupplierPurchase } from '../../models/supplier';

type Shortcut = '7' | '30' | 'todo';

// HU-20: kárdex. Everything that came in and went out of one product, who did it and how much
// was left after each movement. Owner only (adminGuard + Flask 403).
// Dates and page live in the URL (?desde=&hasta=&page=&per_page=), so reload and back keep them.
@Component({
  imports: [RouterLink, DatePipe, DecimalPipe],
  selector: 'app-product-history',
  templateUrl: './product-history.html',
})
export class ProductHistory {
  private dataServices = inject(DataServices);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly productId = Number(this.route.snapshot.paramMap.get('id'));
  readonly pageSizes = [25, 50, 100];
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  readonly tipos = MOVEMENT_TYPES;
  readonly shortcuts: { value: Shortcut; label: string }[] = [
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: 'todo', label: 'Todo' },
  ];

  history = signal<History | null>(null);
  // HU-10: who has brought this product and at what price (cheapest last price first)
  suppliers = signal<SupplierPurchase[] | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // What is applied (comes from the URL)
  desde = signal<string | null>(null);
  hasta = signal<string | null>(null);
  page = signal(1);
  perPage = signal(25);

  // What is typed in the date inputs, applied with "Buscar"
  draftDesde = signal('');
  draftHasta = signal('');
  dateProblem = computed(() => {
    const desde = this.draftDesde();
    const hasta = this.draftHasta();
    return desde && hasta && desde > hasta ? '"Desde" no puede ser después de "Hasta"' : null;
  });

  // Which shortcut matches the applied dates, to highlight it
  activeShortcut = computed<Shortcut | null>(() => {
    const desde = this.desde();
    const hasta = this.hasta();
    if (!desde && !hasta) {
      return 'todo';
    }
    if (hasta === this.today()) {
      if (desde === this.daysAgo(6)) return '7';
      if (desde === this.daysAgo(29)) return '30';
    }
    return null;
  });

  unidad = computed(() => {
    const product = this.history()?.producto;
    return product ? this.unidadLabel[product.unidad_base] : '';
  });

  // "Mostrando 26–50 de 63"
  range = computed(() => {
    const h = this.history();
    if (!h || h.total === 0) {
      return null;
    }
    const from = (h.page - 1) * h.per_page + 1;
    return { from, to: Math.min(h.page * h.per_page, h.total), total: h.total };
  });

  // 1 … 4 [5] 6 … 12: first, last, and the neighbours of the current page
  pageItems = computed<(number | null)[]>(() => {
    const h = this.history();
    if (!h || h.pages <= 1) {
      return [];
    }
    const items: (number | null)[] = [];
    for (let p = 1; p <= h.pages; p++) {
      if (p === 1 || p === h.pages || Math.abs(p - h.page) <= 1) {
        items.push(p);
      } else if (items[items.length - 1] !== null) {
        items.push(null);
      }
    }
    return items;
  });

  private request?: Subscription;

  constructor() {
    this.dataServices.getProductSuppliers(this.productId).subscribe({
      next: (suppliers) => this.suppliers.set(suppliers),
      error: () => this.suppliers.set([]),
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const desde = this.validDate(params.get('desde'));
      const hasta = this.validDate(params.get('hasta'));
      const page = Number(params.get('page'));
      const perPage = Number(params.get('per_page'));
      this.desde.set(desde);
      this.hasta.set(hasta);
      this.page.set(Number.isInteger(page) && page > 0 ? page : 1);
      this.perPage.set(this.pageSizes.includes(perPage) ? perPage : this.pageSizes[0]);
      this.draftDesde.set(desde ?? '');
      this.draftHasta.set(hasta ?? '');
      this.load();
    });
  }

  private load() {
    // Only the last request counts if the user clicks fast
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.dataServices
      .getProductHistory(this.productId, {
        desde: this.desde(),
        hasta: this.hasta(),
        page: this.page(),
        per_page: this.perPage(),
      })
      .subscribe({
        next: (history) => {
          // A page that no longer exists (old link): go to the last one
          if (history.page > history.pages) {
            this.go({ page: history.pages }, true);
            return;
          }
          this.history.set(history);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(this.errorMessage(err));
          this.loading.set(false);
        },
      });
  }

  // Changes the URL; the queryParamMap subscription loads the data
  private go(
    changes: { desde?: string | null; hasta?: string | null; page?: number; per_page?: number },
    replaceUrl = false,
  ) {
    const params = {
      desde: this.desde(),
      hasta: this.hasta(),
      page: this.page(),
      per_page: this.perPage(),
      ...changes,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl,
      queryParams: {
        desde: params.desde || null,
        hasta: params.hasta || null,
        page: params.page > 1 ? params.page : null,
        per_page: params.per_page !== this.pageSizes[0] ? params.per_page : null,
      },
    });
  }

  search() {
    if (this.dateProblem()) {
      return;
    }
    // A new filter always starts on page 1
    this.go({ desde: this.draftDesde() || null, hasta: this.draftHasta() || null, page: 1 });
  }

  useShortcut(shortcut: Shortcut) {
    if (shortcut === 'todo') {
      this.go({ desde: null, hasta: null, page: 1 });
    } else {
      this.go({ desde: this.daysAgo(Number(shortcut) - 1), hasta: this.today(), page: 1 });
    }
  }

  goToPage(page: number) {
    const pages = this.history()?.pages ?? 1;
    if (page >= 1 && page <= pages && page !== this.page()) {
      this.go({ page });
    }
  }

  setPerPage(value: string) {
    this.go({ per_page: Number(value), page: 1 });
  }

  // "Compra" + green, "Merma" + red...
  tipo(movement: ProductMovement) {
    return this.tipos[movement.tipo];
  }

  // "+20 u" / "−2.5 lb"
  signed(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${this.amount(Math.abs(value))}`;
  }

  // Whole numbers without decimals, the rest with up to 3 (HU-07)
  amount(value: number): string {
    return `${+value.toFixed(3)} ${this.unidad()}`;
  }

  // "2026-11-01" -> "01/11/2026". By hand: new Date('2026-11-01') is UTC and can show the day before
  shortDate(iso: string | null): string {
    if (!iso) {
      return '';
    }
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  private today(): string {
    return this.daysAgo(0);
  }

  // Local date as YYYY-MM-DD (toISOString would use UTC)
  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  }

  private validDate(value: string | null): string | null {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  private errorMessage(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'No se pudo conectar con el servidor';
      case 400:
        return 'Las fechas del filtro no son válidas';
      case 403:
        return 'Solo el dueño puede ver el historial de un producto';
      case 404:
        return 'Ese producto no existe';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return 'No se pudo cargar el historial';
    }
  }

  // HU-10: YYYY-MM-DD → dd/MM/yyyy by hand (DatePipe would read it as UTC)
  invoiceDate(date: string): string {
    return date.split('-').reverse().join('/');
  }

  // HU-10: "Q8.00 por lb" (4 decimals only when needed: Q3.3333/m)
  supplierPrice(p: SupplierPurchase): string {
    const decimals = Math.abs(p.precio * 100 - Math.round(p.precio * 100)) < 1e-6 ? 2 : 4;
    return `Q${p.precio.toFixed(decimals)} por ${this.unidadLabel[p.unidad_base]}`;
  }
}
