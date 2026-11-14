import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { Entry, EntryItem, EntryListItem } from '../../models/entry';
import { UnidadBase } from '../../models/product';

@Component({
  imports: [RouterLink, DatePipe, DecimalPipe],
  selector: 'app-entries-list',
  templateUrl: './entries-list.html',
})
export class EntriesList {
  private dataServices = inject(DataServices);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  entries = signal<EntryListItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  // HU-12: "entradas con faltantes"
  onlyShortages = signal(false);

  // The entry opened to see its products
  openId = signal<number | null>(null);
  detail = signal<Entry | null>(null);
  detailLoading = signal(false);

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.openId.set(null);
    this.detail.set(null);
    this.dataServices.getEntries(this.onlyShortages()).subscribe({
      next: (entries) => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las entradas');
        this.loading.set(false);
      },
    });
  }

  setOnlyShortages(value: boolean) {
    this.onlyShortages.set(value);
    this.load();
  }

  // Click on a row: opens its products, click again closes them
  toggle(entry: EntryListItem) {
    if (this.openId() === entry.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(entry.id);
    this.detail.set(null);
    this.detailLoading.set(true);
    this.dataServices.getEntry(entry.id).subscribe({
      next: (detail) => {
        // Ignore the answer if the user already opened another entry
        if (this.openId() === entry.id) {
          this.detail.set(detail);
        }
        this.detailLoading.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el detalle de la entrada');
        this.detailLoading.set(false);
      },
    });
  }

  // "2026-11-09" -> "09/11/2026". Not DatePipe: new Date('2026-11-09') is UTC and can show the day before
  invoiceDate(iso: string): string {
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  // "2 caja" / "18 u": how it came on the invoice
  unit(item: EntryItem): string {
    return item.presentacion ?? this.unidadLabel[item.unidad_base];
  }

  // Positive = missing, negative = more than the invoice said
  difference(item: EntryItem): number {
    return item.cantidad_factura_presentacion - item.cantidad_presentacion;
  }
}
