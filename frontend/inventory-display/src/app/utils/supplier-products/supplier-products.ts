import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { UnidadBase } from '../../models/product';
import { SupplierProducts as SupplierProductsData, SupplierPurchase } from '../../models/supplier';

type SortKey = 'nombre' | 'categoria' | 'precio' | 'cambio' | 'fecha_factura' | 'veces';

// Accents and case do not matter when searching: "plomeria" finds "Plomería"
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// HU-10 (owner only, adminGuard): what a supplier has brought and at what price.
// Built from the valid invoices (HU-11); a voided invoice no longer counts.
@Component({
  imports: [RouterLink, DecimalPipe],
  selector: 'app-supplier-products',
  styleUrl: './supplier-products.css',
  templateUrl: './supplier-products.html',
})
export class SupplierProducts {
  private dataServices = inject(DataServices);

  readonly supplierId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  readonly columns: { key: SortKey; label: string }[] = [
    { key: 'nombre', label: 'Producto' },
    { key: 'categoria', label: 'Categoría' },
    { key: 'precio', label: 'Último precio' },
    { key: 'cambio', label: 'Cambio' },
    { key: 'fecha_factura', label: 'Última compra' },
    { key: 'veces', label: 'Veces' },
  ];

  data = signal<SupplierProductsData | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  query = signal('');
  category = signal('');
  sort = signal<SortState<SortKey> | null>(null);

  categories = computed(() => [
    ...new Set((this.data()?.productos ?? []).map((p) => p.categoria ?? 'Sin categoría')),
  ]);

  shown = computed(() => {
    const words = plain(this.query()).split(/\s+/).filter(Boolean);
    const items = (this.data()?.productos ?? []).filter((p) => {
      if (this.category() && (p.categoria ?? 'Sin categoría') !== this.category()) {
        return false;
      }
      const text = plain(`${p.codigo} ${p.nombre}`);
      return words.every((w) => text.includes(w));
    });
    return sortList(items, this.sort(), (item, key) => item[key]);
  });

  constructor() {
    this.dataServices.getSupplierProducts(this.supplierId).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          err.status === 404
            ? 'Ese proveedor no existe'
            : err.status === 0
              ? 'No se pudo conectar con el servidor'
              : 'No se pudieron cargar los productos del proveedor',
        );
      },
    });
  }

  sortBy(key: SortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  icon(key: SortKey) {
    return sortIcon(this.sort(), key);
  }

  aria(key: SortKey) {
    return ariaSort(this.sort(), key);
  }

  // YYYY-MM-DD → dd/MM/yyyy by hand (DatePipe would read it as UTC and may show the day before)
  invoiceDate(date: string | null): string {
    return date ? date.split('-').reverse().join('/') : '—';
  }

  // "Q8.00 por lb"; prices per base unit can have 4 decimals (Q3.3333/m)
  unitPrice(p: SupplierPurchase): string {
    const decimals = Math.abs(p.precio * 100 - Math.round(p.precio * 100)) < 1e-6 ? 2 : 4;
    return `Q${p.precio.toFixed(decimals)} por ${this.unidadLabel[p.unidad_base]}`;
  }

  // "+6.7 %" in red (it went up), "−3 %" in green
  changeText(cambio: number): string {
    return `${cambio > 0 ? '+' : cambio < 0 ? '−' : ''}${Math.abs(cambio)} %`;
  }

  changeClass(cambio: number | null): string {
    if (!cambio) {
      return 'text-gray-500';
    }
    return cambio > 0 ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold';
  }
}
