import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { negativeStockMessage } from '../../core/utils/negative-stock';
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
  readonly MOTIVO_MAX = 200;

  // HU-14: only the owner sees Corregir and Anular
  isAdmin = inject(AuthService).isAdmin;

  // Message brought back from the correction page ("Factura A-12 de Ferromax corregida")
  notice = signal<string | null>(history.state?.notice ?? null);

  entries = signal<EntryListItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  // HU-12: "entradas con faltantes"
  onlyShortages = signal(false);

  // The entry opened to see its products
  openId = signal<number | null>(null);
  detail = signal<Entry | null>(null);
  detailLoading = signal(false);

  // HU-14: the "Anular" modal. Null = closed
  voiding = signal<EntryListItem | null>(null);
  voidReason = signal('');
  voidSaving = signal(false);
  voidError = signal<string | null>(null);
  // Part of it was already taken out: offer Corregir instead
  voidBlocked = signal(false);

  constructor() {
    this.load();
    // Show the notice once: a reload of the page should not bring it back
    if (history.state?.notice) {
      const { notice, ...state } = history.state;
      history.replaceState(state, '');
    }
  }

  openVoid(entry: EntryListItem) {
    this.notice.set(null);
    this.voidReason.set('');
    this.voidError.set(null);
    this.voidBlocked.set(false);
    this.voiding.set(entry);
  }

  closeVoid() {
    if (!this.voidSaving()) {
      this.voiding.set(null);
    }
  }

  confirmVoid() {
    const entry = this.voiding();
    const motivo = this.voidReason().trim();
    if (!entry || !motivo || motivo.length > this.MOTIVO_MAX || this.voidSaving()) {
      return;
    }
    this.voidError.set(null);
    this.voidSaving.set(true);
    this.dataServices.voidEntry(entry.id, motivo).subscribe({
      next: (voided) => {
        // Same row, now marked as voided (it is not removed from the list)
        this.entries.update((list) =>
          list.map((e) =>
            e.id === voided.id
              ? {
                  ...e,
                  anulada: voided.anulada,
                  anulada_en: voided.anulada_en,
                  anulada_por_id: voided.anulada_por_id,
                  anulada_por: voided.anulada_por,
                  motivo_anulacion: voided.motivo_anulacion,
                }
              : e,
          ),
        );
        if (this.openId() === voided.id) {
          this.detail.set(voided);
        }
        this.notice.set(`Factura ${voided.numero_factura} de ${voided.proveedor} anulada`);
        this.voidSaving.set(false);
        this.voiding.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.voidSaving.set(false);
        if (err.status === 409 && err.error?.data?.productos) {
          // HU-18: it cannot leave a product below 0
          this.voidBlocked.set(true);
          this.voidError.set(
            `No se puede anular: ${negativeStockMessage(err.error.data.productos)}. ` +
              'Ya se sacó parte de esta mercadería; use Corregir para dejar la cantidad correcta.',
          );
        } else if (err.status === 400 && err.error?.message === 'entry is already voided') {
          this.voidError.set('Esta entrada ya fue anulada');
          this.load();
        } else if (err.status === 403) {
          this.voidError.set('Solo el dueño puede anular entradas');
        } else if (err.status === 0) {
          this.voidError.set('No se pudo conectar con el servidor');
        } else {
          this.voidError.set('No se pudo anular la entrada');
        }
      },
    });
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
