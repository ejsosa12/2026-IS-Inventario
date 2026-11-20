import { afterNextRender, Component, inject, Injector, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { Sale } from '../../models/sale';
import { UnidadBase } from '../../models/product';

// The store printed on the ticket. FICTITIOUS data for the school project (decided 2026-11-19);
// the NIT has a valid check digit only so it looks like a real one.
const STORE = {
  nombre: 'FERRETERÍA EL BUEN CLAVO',
  razonSocial: 'Ferretería El Buen Clavo, S.A.',
  nit: '1234567-9',
  direccion: '5a avenida 3-21, zona 1, Guatemala',
  telefono: '2222-0000',
};

// HU-15: an 80 mm thermal ticket in Guatemalan style. It is NOT a FEL invoice (no SAT
// authorization, serie or certifier), so it always says it has no fiscal value.
// Lives outside 'content' (route print/sale/:id) so it prints without the sidebar.
@Component({
  imports: [DecimalPipe],
  selector: 'app-sale-ticket',
  styleUrl: './sale-ticket.css',
  templateUrl: './sale-ticket.html',
})
export class SaleTicket {
  private dataServices = inject(DataServices);
  private injector = inject(Injector);

  readonly store = STORE;
  readonly saleId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  sale = signal<Sale | null>(null);
  error = signal<string | null>(null);

  constructor() {
    this.dataServices.getSale(this.saleId).subscribe({
      next: (sale) => {
        this.sale.set(sale);
        // Open the print dialog once the ticket is on screen
        afterNextRender(() => window.print(), { injector: this.injector });
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(err.status === 404 ? 'Esa venta no existe' : 'No se pudo cargar la venta'),
    });
  }

  saleNumber(id: number): string {
    return String(id).padStart(6, '0');
  }

  // "2026-11-19T14:32:05" -> "19/11/2026 14:32" (by hand: no time zone in the text)
  date(iso: string): string {
    const [day, time] = iso.split('T');
    const [y, m, d] = day.split('-');
    return `${d}/${m}/${y} ${time.slice(0, 5)}`;
  }

  // Whole numbers for "unidad", up to 3 decimals for lb, m and gal (HU-07)
  qtyFormat(unidad: UnidadBase): string {
    return unidad === 'unidad' ? '1.0-0' : '1.0-3';
  }

  print() {
    window.print();
  }

  close() {
    window.close();
  }
}
