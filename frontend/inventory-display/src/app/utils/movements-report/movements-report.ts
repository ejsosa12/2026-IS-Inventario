import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataServices } from '../../core/services/data-services';
import { MOVEMENT_TYPES } from '../../core/utils/movement-types';
import {
  MovementTipo,
  MovementsReport as Report,
  ReportMovement,
} from '../../models/movement';
import { UnidadBase } from '../../models/product';
import { User } from '../../models/user';

type Shortcut = 'hoy' | 'ayer' | '7' | '30' | 'todo';

// HU-27 (owner only, adminGuard; a tab of Análisis): "qué se movió ayer, y qué registró cada
// uno de los muchachos". Every movement of every product, filtered by date, type and user.
// The filters and the page live in the URL like the kárdex (HU-20). With no dates in the URL
// it opens on the last 7 days (decided 2026-11-17); "Todo" is ?todo=1.
@Component({
  imports: [RouterLink, DatePipe, DecimalPipe],
  selector: 'app-movements-report',
  styleUrl: './movements-report.css',
  templateUrl: './movements-report.html',
})
export class MovementsReport {
  private dataServices = inject(DataServices);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly pageSizes = [25, 50, 100];
  readonly tipos = MOVEMENT_TYPES;
  readonly tipoKeys = Object.keys(MOVEMENT_TYPES) as MovementTipo[];
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  readonly shortcuts: { value: Shortcut; label: string }[] = [
    { value: 'hoy', label: 'Hoy' },
    { value: 'ayer', label: 'Ayer' },
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: 'todo', label: 'Todo' },
  ];

  report = signal<Report | null>(null);
  users = signal<User[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  // What is applied (comes from the URL)
  desde = signal<string | null>(null);
  hasta = signal<string | null>(null);
  tipo = signal<MovementTipo | null>(null);
  usuarioId = signal<number | null>(null);
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

  activeShortcut = computed<Shortcut | null>(() => {
    const desde = this.desde();
    const hasta = this.hasta();
    if (!desde && !hasta) return 'todo';
    if (desde === this.daysAgo(1) && hasta === this.daysAgo(1)) return 'ayer';
    if (hasta !== this.today()) return null;
    if (desde === this.today()) return 'hoy';
    if (desde === this.daysAgo(6)) return '7';
    if (desde === this.daysAgo(29)) return '30';
    return null;
  });

  // One card per type that moved in the range (in the usual order)
  typeCards = computed(() => {
    const byType = new Map((this.report()?.por_tipo ?? []).map((t) => [t.tipo, t]));
    return this.tipoKeys.filter((t) => byType.has(t)).map((t) => byType.get(t)!);
  });

  // Name of the user being filtered (for the "Filtrando" chip)
  userName = computed(() => {
    const id = this.usuarioId();
    return this.users().find((u) => u.id === id)?.nombre ?? null;
  });

  range = computed(() => {
    const r = this.report();
    if (!r || r.total === 0) {
      return null;
    }
    const from = (r.page - 1) * r.per_page + 1;
    return { from, to: Math.min(r.page * r.per_page, r.total), total: r.total };
  });

  // 1 … 4 [5] 6 … 12
  pageItems = computed<(number | null)[]>(() => {
    const r = this.report();
    if (!r || r.pages <= 1) {
      return [];
    }
    const items: (number | null)[] = [];
    for (let p = 1; p <= r.pages; p++) {
      if (p === 1 || p === r.pages || Math.abs(p - r.page) <= 1) {
        items.push(p);
      } else if (items[items.length - 1] !== null) {
        items.push(null);
      }
    }
    return items;
  });

  private request?: Subscription;

  constructor() {
    this.dataServices.getUsers().subscribe({ next: (users) => this.users.set(users) });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const desde = this.validDate(params.get('desde'));
      const hasta = this.validDate(params.get('hasta'));
      // Opening the page with no dates: last 7 days
      if (!desde && !hasta && params.get('todo') !== '1') {
        this.router.navigate([], {
          relativeTo: this.route,
          replaceUrl: true,
          queryParams: { desde: this.daysAgo(6), hasta: this.today() },
          queryParamsHandling: 'merge',
        });
        return;
      }
      const tipo = params.get('tipo') as MovementTipo | null;
      const usuario = Number(params.get('usuario'));
      const page = Number(params.get('page'));
      const perPage = Number(params.get('per_page'));
      this.desde.set(desde);
      this.hasta.set(hasta);
      this.tipo.set(tipo && tipo in MOVEMENT_TYPES ? tipo : null);
      this.usuarioId.set(Number.isInteger(usuario) && usuario > 0 ? usuario : null);
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
      .getMovements({
        desde: this.desde(),
        hasta: this.hasta(),
        tipo: this.tipo(),
        usuario_id: this.usuarioId(),
        page: this.page(),
        per_page: this.perPage(),
      })
      .subscribe({
        next: (report) => {
          if (report.page > report.pages) {
            this.go({ page: report.pages }, true);
            return;
          }
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
                : 'No se pudieron cargar los movimientos',
          );
        },
      });
  }

  // Changes the URL; the queryParamMap subscription loads the data
  private go(
    changes: {
      desde?: string | null;
      hasta?: string | null;
      tipo?: MovementTipo | null;
      usuario?: number | null;
      page?: number;
      per_page?: number;
    },
    replaceUrl = false,
  ) {
    const p = {
      desde: this.desde(),
      hasta: this.hasta(),
      tipo: this.tipo(),
      usuario: this.usuarioId(),
      page: this.page(),
      per_page: this.perPage(),
      ...changes,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl,
      queryParams: {
        desde: p.desde || null,
        hasta: p.hasta || null,
        todo: !p.desde && !p.hasta ? 1 : null,
        tipo: p.tipo || null,
        usuario: p.usuario || null,
        page: p.page > 1 ? p.page : null,
        per_page: p.per_page !== this.pageSizes[0] ? p.per_page : null,
      },
    });
  }

  search() {
    if (this.dateProblem()) {
      return;
    }
    this.go({ desde: this.draftDesde() || null, hasta: this.draftHasta() || null, page: 1 });
  }

  useShortcut(shortcut: Shortcut) {
    const ranges: Record<Shortcut, [string | null, string | null]> = {
      hoy: [this.today(), this.today()],
      ayer: [this.daysAgo(1), this.daysAgo(1)],
      '7': [this.daysAgo(6), this.today()],
      '30': [this.daysAgo(29), this.today()],
      todo: [null, null],
    };
    const [desde, hasta] = ranges[shortcut];
    this.go({ desde, hasta, page: 1 });
  }

  // Clicking a card or a user filters by it; clicking the active one clears it
  pickType(tipo: MovementTipo | null) {
    this.go({ tipo: tipo === this.tipo() ? null : tipo, page: 1 });
  }

  pickUser(id: number | null) {
    this.go({ usuario: id === this.usuarioId() ? null : id, page: 1 });
  }

  setType(value: string) {
    this.go({ tipo: (value || null) as MovementTipo | null, page: 1 });
  }

  setUser(value: string) {
    this.go({ usuario: value ? Number(value) : null, page: 1 });
  }

  clearFilters() {
    this.go({ tipo: null, usuario: null, page: 1 });
  }

  goToPage(page: number) {
    const pages = this.report()?.pages ?? 1;
    if (page >= 1 && page <= pages && page !== this.page()) {
      this.go({ page });
    }
  }

  setPerPage(value: string) {
    this.go({ per_page: Number(value), page: 1 });
  }

  // "+20 u" / "−2.5 lb"
  signed(m: ReportMovement): string {
    const sign = m.cantidad > 0 ? '+' : m.cantidad < 0 ? '−' : '';
    return `${sign}${+Math.abs(m.cantidad).toFixed(3)} ${this.unidadLabel[m.unidad_base]}`;
  }

  // "2026-11-01" -> "01/11/2026" by hand (new Date('2026-11-01') is UTC)
  shortDate(iso: string | null): string {
    return iso ? iso.split('-').reverse().join('/') : '';
  }

  private validDate(value: string | null): string | null {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  // Local dates as YYYY-MM-DD (not toISOString, which is UTC)
  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private today(): string {
    return this.daysAgo(0);
  }
}
