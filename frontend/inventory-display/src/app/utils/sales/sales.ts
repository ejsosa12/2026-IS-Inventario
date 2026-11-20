import {
  afterNextRender,
  Component,
  computed,
  HostListener,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DataServices } from '../../core/services/data-services';
import { normalizeNit } from '../../core/utils/nit';
import { injectPresentations } from '../../core/utils/two-units';
import { ProductListItem, UnidadBase } from '../../models/product';
import { Sale, SalesOfDay, SaleStockProblem } from '../../models/sale';

// One product of the sale being typed. cantidad stays as typed text ("1,5") until saved
interface SaleLine {
  product: ProductListItem;
  cantidad: string;
}

// HU-15: "Que sea rapidito: busco, pongo cuánto y listo". Built for the keyboard:
// Enter in the search adds the first result and jumps to its quantity, Enter in the quantity
// goes back to the search, Ctrl+Enter registers the sale. Any logged-in user.
@Component({
  imports: [DecimalPipe],
  selector: 'app-sales',
  styleUrl: './sales.css',
  templateUrl: './sales.html',
})
export class Sales {
  private dataServices = inject(DataServices);
  private injector = inject(Injector);

  products = signal<ProductListItem[]>([]);
  loadingProducts = signal(true);

  query = signal('');
  lines = signal<SaleLine[]>([]);
  nit = signal('CF');
  nombre = signal('');

  saving = signal(false);
  error = signal<string | null>(null);
  lastSale = signal<Sale | null>(null);

  today = signal<SalesOfDay | null>(null);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-08: "(1.5 cajas)" next to the stock
  readonly pres = injectPresentations();

  // HU-03 matching over active products (HU-04), at most 8 so the list stays short
  results = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return this.products()
      .filter((product) => {
        const text = this.normalize(`${product.nombre} ${product.codigo}`);
        return words.every((word) => text.includes(word));
      })
      .slice(0, 8);
  });

  total = computed(() =>
    this.lines().reduce((sum, line) => sum + (this.subtotal(line) ?? 0), 0),
  );

  nitValue = computed(() => normalizeNit(this.nit()));

  // Spanish message for the client box, or null
  clientProblem = computed(() => {
    const nit = this.nitValue();
    if (nit === null) return 'El NIT no es válido (revise el dígito verificador) o escriba CF';
    if (nit !== 'CF' && !this.nombre().trim()) return 'Con NIT se necesita el nombre del cliente';
    if (this.nombre().trim().length > 100) return 'El nombre puede tener hasta 100 letras';
    return null;
  });

  canSave = computed(
    () =>
      !this.saving() &&
      this.lines().length > 0 &&
      this.clientProblem() === null &&
      this.lines().every((line) => this.lineProblem(line) === null),
  );

  constructor() {
    this.loadProducts();
    this.loadToday();
  }

  private loadProducts() {
    this.dataServices.getProducts().subscribe({
      next: (products) => {
        this.products.set(products.filter((p) => p.activo));
        this.loadingProducts.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los productos');
        this.loadingProducts.set(false);
      },
    });
  }

  private loadToday() {
    this.dataServices.getSales().subscribe({ next: (day) => this.today.set(day) });
  }

  // Enter in the search box
  addFirst(event: Event) {
    event.preventDefault();
    const first = this.results()[0];
    if (first) this.add(first);
  }

  // Already in the sale: one more. New: quantity 1. Then the cursor goes to its quantity
  add(product: ProductListItem) {
    this.lastSale.set(null);
    this.error.set(null);
    this.lines.update((lines) => {
      const found = lines.find((line) => line.product.id === product.id);
      if (found) {
        const current = this.parse(found.cantidad) ?? 0;
        return lines.map((line) =>
          line === found ? { ...line, cantidad: String(+(current + 1).toFixed(3)) } : line,
        );
      }
      return [...lines, { product, cantidad: '1' }];
    });
    this.query.set('');
    this.focus(`qty-${product.id}`, true);
  }

  setQuantity(line: SaleLine, value: string) {
    this.lines.update((lines) => lines.map((l) => (l === line ? { ...l, cantidad: value } : l)));
  }

  remove(line: SaleLine) {
    this.lines.update((lines) => lines.filter((l) => l !== line));
    this.focus('sale-search');
  }

  // Enter in a quantity: back to the search for the next product
  backToSearch(event: Event) {
    event.preventDefault();
    this.focus('sale-search');
  }

  @HostListener('document:keydown.control.enter', ['$event'])
  shortcut(event: Event) {
    event.preventDefault();
    this.save();
  }

  // "1,5" -> 1.5; empty or not a number -> null
  private parse(text: string): number | null {
    const value = Number(text.replace(',', '.').trim());
    return text.trim() !== '' && Number.isFinite(value) ? value : null;
  }

  // Same rules as Flask: > 0, at most 3 decimals, whole for "unidad" (HU-07), enough stock (HU-18)
  lineProblem(line: SaleLine): string | null {
    const value = this.parse(line.cantidad);
    if (value === null || value <= 0) return 'Escriba la cantidad';
    if (!Number.isInteger(+(value * 1000).toFixed(6))) return 'Máximo 3 decimales';
    if (line.product.unidad_base === 'unidad' && !Number.isInteger(value)) {
      return 'Solo cantidades enteras';
    }
    if (value > line.product.existencia) {
      return `Solo hay ${+line.product.existencia.toFixed(3)} ${this.unidadLabel[line.product.unidad_base]}`;
    }
    return null;
  }

  subtotal(line: SaleLine): number | null {
    const value = this.parse(line.cantidad);
    return value === null ? null : Math.round(value * line.product.precio * 100) / 100;
  }

  // The IVA inside the total (Guatemala: prices include 12 %)
  iva(total: number): number {
    return Math.round((total - total / 1.12) * 100) / 100;
  }

  save() {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    this.dataServices
      .addSale({
        nit_cliente: this.nitValue() ?? 'CF',
        nombre_cliente: this.nombre().trim(),
        items: this.lines().map((line) => ({
          producto_id: line.product.id,
          cantidad: this.parse(line.cantidad) ?? 0,
        })),
      })
      .subscribe({
        next: (sale) => {
          this.saving.set(false);
          this.lastSale.set(sale);
          this.lines.set([]);
          this.nit.set('CF');
          this.nombre.set('');
          this.loadProducts(); // the stock went down
          this.loadToday();
          // Enter prints the ticket; typing in the search starts the next sale
          this.focus('print-ticket');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.errorMessage(err));
        },
      });
  }

  private errorMessage(err: HttpErrorResponse): string {
    if (err.status === 409 && err.error?.data?.productos) {
      // HU-18: someone sold or took them meanwhile. Update the stock shown and say which ones
      const problems = err.error.data.productos as SaleStockProblem[];
      const stock = new Map(problems.map((p) => [p.producto_id, p.existencia]));
      const update = (p: ProductListItem) =>
        stock.has(p.id) ? { ...p, existencia: stock.get(p.id)! } : p;
      this.products.update((products) => products.map(update));
      this.lines.update((lines) => lines.map((l) => ({ ...l, product: update(l.product) })));
      const names = problems
        .map((p) => `${p.nombre} (hay ${+p.existencia.toFixed(3)} ${this.unidadLabel[p.unidad_base]})`)
        .join(', ');
      return `No alcanza la existencia: ${names}. No se guardó nada.`;
    }
    if (err.status === 0) return 'No hay conexión con el servidor';
    if (err.status === 400) return `Revise la venta: ${err.error?.message ?? 'datos inválidos'}`;
    return 'No se pudo registrar la venta';
  }

  openTicket(id: number) {
    window.open(`/print/sale/${id}`, '_blank');
  }

  newSale() {
    this.lastSale.set(null);
    this.focus('sale-search');
  }

  // "2026-11-19T14:32:05" -> "14:32" (by hand: the server sends local time without a zone)
  hour(iso: string): string {
    return iso.slice(11, 16);
  }

  saleNumber(id: number): string {
    return String(id).padStart(6, '0');
  }

  private focus(id: string, select = false) {
    afterNextRender(
      () => {
        const element = document.getElementById(id) as HTMLInputElement | null;
        element?.focus();
        if (select) element?.select();
      },
      { injector: this.injector },
    );
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }
}
