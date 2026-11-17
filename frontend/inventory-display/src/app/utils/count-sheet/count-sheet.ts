import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { CountDetail, CountItem } from '../../models/count';
import { Presentation } from '../../models/entry';
import { UnidadBase } from '../../models/product';

// HU-32: the sheets to count, one per category, ready to print.
// Lives outside 'content' (route print/count/:id) so it prints without the sidebar.
// It never shows the system's stock, so the count is honest.
@Component({
  imports: [DatePipe],
  selector: 'app-count-sheet',
  templateUrl: './count-sheet.html',
})
export class CountSheet {
  private dataServices = inject(DataServices);
  private injector = inject(Injector);

  readonly countId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly unidadNombre: Record<UnidadBase, string> = {
    unidad: 'unidades',
    lb: 'libras',
    m: 'metros',
    gal: 'galones',
  };
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  count = signal<CountDetail | null>(null);
  presentations = signal<Presentation[]>([]);
  error = signal<string | null>(null);
  printedAt = new Date();

  // One sheet per category, in the order Flask sends the products
  sheets = computed(() => {
    const groups = new Map<string, CountItem[]>();
    for (const item of this.count()?.items ?? []) {
      const name = item.categoria ?? 'Sin categoría';
      groups.set(name, [...(groups.get(name) ?? []), item]);
    }
    return [...groups].map(([categoria, items]) => ({ categoria, items }));
  });

  constructor() {
    this.dataServices.getPresentations().subscribe({
      next: (presentations) => this.presentations.set(presentations),
    });
    this.dataServices.getCount(this.countId).subscribe({
      next: (count) => {
        this.count.set(count);
        // Open the print dialog once the sheets are on screen (only for an open count)
        if (count.estado === 'abierto') {
          afterNextRender(() => window.print(), { injector: this.injector });
        }
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(err.status === 404 ? 'Ese conteo no existe' : 'No se pudo cargar el conteo'),
    });
  }

  // HU-06 hint for products bought in boxes/rolls: "1 caja = 50 lb"
  hint(item: CountItem): string {
    return this.presentations()
      .filter((p) => p.producto_id === item.producto_id)
      .sort((a, b) => b.factor - a.factor)
      .map((p) => `1 ${p.nombre} = ${+p.factor.toFixed(3)} ${this.unidadLabel[item.unidad_base]}`)
      .join(' · ');
  }

  print() {
    window.print();
  }

  close() {
    window.close();
  }
}
