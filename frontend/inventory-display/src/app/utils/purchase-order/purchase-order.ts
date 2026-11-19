import { Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DataServices } from '../../core/services/data-services';
import { pluralize } from '../../core/utils/two-units';
import { PurchaseOrder, PurchaseOrderGroup, PurchaseOrderLine } from '../../models/supplier';
import { UnidadBase } from '../../models/product';

// HU-23: "Que me arme la lista de lo que tengo que pedir, separado por proveedor".
// Owner only (adminGuard): it shows purchase prices. Works on the phone view too (HU-19).
@Component({
  imports: [DecimalPipe],
  selector: 'app-purchase-order',
  templateUrl: './purchase-order.html',
  // The print rules must reach the sidebar and the phone bar, which live outside this component
  styleUrl: './purchase-order.css',
  encapsulation: ViewEncapsulation.None,
})
export class PurchaseOrderPage {
  private dataServices = inject(DataServices);

  order = signal<PurchaseOrder | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // What to order of each product, in the ORDER unit: presentations if the last invoice came
  // in one (3 cajas), otherwise the base unit (28 u). 0 = leave it out. Starts at the suggestion.
  qty = signal(new Map<number, number>());

  // Which "Copiar" button was just pressed (key = proveedor_id, 'all' for everything)
  copied = signal<string | null>(null);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // Cards on top: only the products still in the order
  summary = computed(() => {
    const groups = this.order()?.proveedores ?? [];
    let productos = 0;
    let total = 0;
    let proveedores = 0;
    for (const group of groups) {
      const lines = this.included(group);
      productos += lines.length;
      total += this.groupTotal(group);
      if (lines.length > 0 && group.proveedor_id !== null) proveedores++;
    }
    return { productos, total, proveedores };
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.dataServices.getPurchaseOrder().subscribe({
      next: (order) => {
        const qty = new Map<number, number>();
        for (const group of order.proveedores) {
          for (const line of group.productos) {
            qty.set(line.producto_id, this.suggested(line));
          }
        }
        this.qty.set(qty);
        this.order.set(order);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo armar la lista de pedido');
        this.loading.set(false);
      },
    });
  }

  // The suggestion in the order unit
  suggested(line: PurchaseOrderLine): number {
    return line.presentacion ? line.presentacion.cantidad : line.sugerido;
  }

  amount(line: PurchaseOrderLine): number {
    return this.qty().get(line.producto_id) ?? 0;
  }

  setAmount(line: PurchaseOrderLine, raw: string) {
    const value = Number(raw.replace(',', '.'));
    this.qty.update((map) => {
      const copy = new Map(map);
      // Whole numbers only: we order whole cajas / units. Empty or invalid = 0 (left out)
      copy.set(line.producto_id, Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0);
      return copy;
    });
  }

  remove(line: PurchaseOrderLine) {
    this.setAmount(line, '0');
  }

  restore(line: PurchaseOrderLine) {
    this.setAmount(line, String(this.suggested(line)));
  }

  included(group: PurchaseOrderGroup): PurchaseOrderLine[] {
    return group.productos.filter((line) => this.amount(line) > 0);
  }

  // "3 cajas", "1 caja", "28 u", "12 lb"
  orderUnit(line: PurchaseOrderLine, amount = this.amount(line)): string {
    if (line.presentacion) {
      const name = line.presentacion.nombre.trim().toLowerCase();
      return amount === 1 ? name : pluralize(name);
    }
    return this.unidadLabel[line.unidad_base];
  }

  // "= 150 lb" when ordering in a presentation
  inBase(line: PurchaseOrderLine): number | null {
    return line.presentacion ? this.amount(line) * line.presentacion.factor : null;
  }

  // Price of one order unit (one caja, or one base unit)
  unitPrice(line: PurchaseOrderLine): number | null {
    return line.presentacion ? line.precio_presentacion : line.precio;
  }

  lineCost(line: PurchaseOrderLine): number | null {
    const price = this.unitPrice(line);
    return price === null ? null : this.amount(line) * price;
  }

  groupTotal(group: PurchaseOrderGroup): number {
    return this.included(group).reduce((sum, line) => sum + (this.lineCost(line) ?? 0), 0);
  }

  groupWithoutPrice(group: PurchaseOrderGroup): number {
    return this.included(group).filter((line) => this.lineCost(line) === null).length;
  }

  groupKey(group: PurchaseOrderGroup): string {
    return String(group.proveedor_id ?? 'none');
  }

  // YYYY-MM-DD -> DD/MM/YYYY by hand (DatePipe would read it as UTC and can show the day before)
  date(value: string | null): string {
    if (!value) return '';
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }

  // The text sent to the supplier (no prices: those are for the owner)
  groupText(group: PurchaseOrderGroup): string {
    const fecha = this.date(this.order()?.fecha ?? null);
    const who = [group.contacto, group.telefono].filter(Boolean).join(', ');
    const header = group.nombre ? `${group.nombre}${who ? ` (${who})` : ''}` : 'Sin proveedor';
    const lines = this.included(group).map(
      (line) => `- ${line.nombre}: ${this.amount(line)} ${this.orderUnit(line)}`,
    );
    return [`Pedido – Ferretería El Buen Clavo – ${fecha}`, header, ...lines].join('\n');
  }

  allText(): string {
    return (this.order()?.proveedores ?? [])
      .filter((group) => this.included(group).length > 0)
      .map((group) => this.groupText(group))
      .join('\n\n');
  }

  async copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Old browsers or a non-HTTPS page: the hidden-textarea trick
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    this.copied.set(key);
    setTimeout(() => this.copied.update((current) => (current === key ? null : current)), 2000);
  }

  // wa.me needs the number with country code; an 8-digit number is Guatemalan (+502)
  whatsappUrl(group: PurchaseOrderGroup): string | null {
    const digits = (group.telefono ?? '').replace(/\D/g, '');
    if (!digits || this.included(group).length === 0) return null;
    const phone = digits.length === 8 ? `502${digits}` : digits;
    return `https://wa.me/${phone}?text=${encodeURIComponent(this.groupText(group))}`;
  }

  print() {
    window.print();
  }
}
