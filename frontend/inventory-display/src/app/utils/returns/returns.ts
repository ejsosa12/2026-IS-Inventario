import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { UnidadBase } from '../../models/product';
import { ReturnProblem, ReturnRow, Sale, SaleItem } from '../../models/sale';

// HU-13: "Viene la señora a devolver la chapa porque no le quedó. Si está buena, vuelve al
// estante." Any logged-in user. Always against a ticket (decided 2026-11-20, option A): the
// sale number printed on it, or the sale picked from the list of a day if the customer lost
// the paper. Per product: how much comes back and whether it is good (adds stock) or damaged
// (registered and written off as a merma, so it does not add). No time limit.
@Component({
  imports: [DecimalPipe, RouterLink],
  selector: 'app-returns',
  templateUrl: './returns.html',
})
export class Returns {
  private dataServices = inject(DataServices);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  readonly motivoMax = 150;
  // HU-08: "(1.5 cajas)" next to quantities
  readonly pres = injectPresentations();

  // Finding the sale
  ticket = signal('');
  searching = signal(false);
  findError = signal<string | null>(null);
  sale = signal<Sale | null>(null);

  // "Buscar por fecha" when the customer lost the ticket
  showByDate = signal(false);
  day = signal(this.today());
  daySales = signal<Sale[] | null>(null);

  // What comes back, by producto_id: quantity as typed ("1,5") and good / damaged
  qty = signal<Record<number, string>>({});
  damaged = signal<Record<number, boolean>>({});
  motivo = signal('');

  saving = signal(false);
  saveError = signal<string | null>(null);
  problems = signal<ReturnProblem[]>([]);
  done = signal<{ venta_id: number; devolver: number } | null>(null);

  recent = signal<ReturnRow[]>([]);

  // Products with something typed, already checked
  chosen = computed(() => {
    const sale = this.sale();
    if (!sale?.items) return [];
    return sale.items
      .map((item) => ({ item, cantidad: this.parse(this.qty()[item.producto_id]) }))
      .filter((line) => line.cantidad !== null && line.cantidad > 0 && !this.problem(line.item));
  });

  hasProblems = computed(() => (this.sale()?.items ?? []).some((item) => this.problem(item)));

  // Money to give back: same rounding as Flask (each line to cents)
  devolver = computed(() =>
    this.chosen().reduce(
      (sum, { item, cantidad }) => sum + Math.round(cantidad! * item.precio * 100) / 100,
      0,
    ),
  );

  constructor() {
    this.loadRecent();
    // From "Ventas de hoy" (Vender): /content/returns?venta=12
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const venta = Number(params.get('venta'));
      if (Number.isInteger(venta) && venta > 0) {
        this.ticket.set(String(venta));
        this.find();
      }
    });
  }

  // "000012", "12" or "#12" -> 12
  find() {
    const id = Number(this.ticket().replace(/[^\d]/g, ''));
    if (!id) {
      this.findError.set('Escriba el número de venta del ticket');
      return;
    }
    this.loadSale(id);
  }

  private loadSale(id: number, keepDone = false) {
    this.searching.set(true);
    this.findError.set(null);
    if (!keepDone) this.done.set(null);
    this.dataServices.getSale(id).subscribe({
      next: (sale) => {
        this.searching.set(false);
        this.pick(sale, keepDone);
      },
      error: (err: HttpErrorResponse) => {
        this.searching.set(false);
        this.sale.set(null);
        this.findError.set(
          err.status === 404
            ? `No existe la venta No. ${this.saleNumber(id)}`
            : err.status === 0
              ? 'No se pudo conectar con el servidor'
              : 'No se pudo buscar la venta',
        );
      },
    });
  }

  private pick(sale: Sale, keepDone = false) {
    this.sale.set(sale);
    this.ticket.set(this.saleNumber(sale.id));
    this.qty.set({});
    this.damaged.set({});
    this.motivo.set('');
    this.saveError.set(null);
    this.problems.set([]);
    if (!keepDone) this.done.set(null);
  }

  // Picking a sale from the list of a day loads it with its products
  choose(sale: Sale) {
    this.showByDate.set(false);
    this.loadSale(sale.id);
  }

  toggleByDate() {
    this.showByDate.update((v) => !v);
    if (this.showByDate() && this.daySales() === null) {
      this.loadDay();
    }
  }

  loadDay() {
    this.daySales.set(null);
    this.dataServices.getSales(this.day() || undefined).subscribe({
      next: (day) => this.daySales.set(day.ventas),
      error: () => this.daySales.set([]),
    });
  }

  clear() {
    this.sale.set(null);
    this.ticket.set('');
    this.done.set(null);
    this.findError.set(null);
  }

  setQty(item: SaleItem, value: string) {
    this.qty.update((q) => ({ ...q, [item.producto_id]: value }));
  }

  setDamaged(item: SaleItem, value: boolean) {
    this.damaged.update((d) => ({ ...d, [item.producto_id]: value }));
  }

  // "Todo": the whole quantity that can still be returned
  all(item: SaleItem) {
    this.setQty(item, String(item.por_devolver));
  }

  // Same rules as Flask; empty = this product does not come back
  problem(item: SaleItem): string | null {
    const text = (this.qty()[item.producto_id] ?? '').trim();
    if (!text) return null;
    const value = this.parse(text);
    if (value === null || value < 0) return 'Cantidad no válida';
    if (value === 0) return null;
    if (!/^\d+([.,]\d{1,3})?$/.test(text)) return 'Máximo 3 decimales';
    if (item.unidad_base === 'unidad' && !Number.isInteger(value)) return 'Debe ser un número entero';
    if (value > item.por_devolver + 1e-9) {
      return item.por_devolver > 0
        ? `Solo se pueden devolver ${this.amount(item.por_devolver, item.unidad_base)}`
        : 'Ya se devolvió todo';
    }
    return null;
  }

  save() {
    const sale = this.sale();
    if (!sale || this.saving() || this.hasProblems() || !this.chosen().length) return;
    if (this.motivo().length > this.motivoMax) return;
    const items = this.chosen().map(({ item, cantidad }) => ({
      producto_id: item.producto_id,
      cantidad: cantidad!,
      danado: !!this.damaged()[item.producto_id],
    }));
    this.saving.set(true);
    this.saveError.set(null);
    this.problems.set([]);
    this.dataServices
      .addReturn({ venta_id: sale.id, motivo: this.motivo().trim(), items })
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.pick(result.venta);
          this.done.set({ venta_id: result.venta_id, devolver: result.devolver });
          this.loadRecent();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          if (err.status === 409 && err.error?.data?.productos) {
            // Someone returned part of it meanwhile: show what is left now
            this.problems.set(err.error.data.productos);
            this.saveError.set('Otra persona ya devolvió parte de esta venta. Revise las cantidades.');
            this.loadSale(sale.id, true);
          } else {
            this.saveError.set(
              err.status === 0
                ? 'No se pudo conectar con el servidor'
                : err.status === 404
                  ? 'La venta ya no existe'
                  : 'No se pudo registrar la devolución',
            );
          }
        },
      });
  }

  private loadRecent() {
    this.dataServices.getReturns().subscribe({ next: (rows) => this.recent.set(rows) });
  }

  // "1,5" -> 1.5; '' -> 0; anything else -> null
  private parse(text: string | undefined): number | null {
    const clean = (text ?? '').trim().replace(',', '.');
    if (!clean) return 0;
    const value = Number(clean);
    return Number.isFinite(value) ? value : null;
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    return `${+value.toFixed(unidad === 'unidad' ? 0 : 3)} ${this.unidadLabel[unidad]}`;
  }

  saleNumber(id: number): string {
    return String(id).padStart(6, '0');
  }

  // "2026-11-19T14:32:05" -> "19/11/2026 14:32" by hand (the server sends local time)
  dateTime(iso: string): string {
    return `${iso.slice(0, 10).split('-').reverse().join('/')} ${iso.slice(11, 16)}`;
  }

  hour(iso: string): string {
    return iso.slice(11, 16);
  }

  private today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
