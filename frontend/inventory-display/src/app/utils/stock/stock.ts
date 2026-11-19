import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ProductListItem, UnidadBase } from '../../models/product';

interface Estado {
  label: string;
  rank: number; // the urgent ones first
  classes: string;
}

// HU-19: "Ver desde el teléfono cuánto hay". Read-only stock list made for a phone screen
// (cards instead of a table), with search and a category filter. Any logged-in user: no money here.
@Component({
  imports: [DecimalPipe],
  selector: 'app-stock',
  templateUrl: './stock.html',
})
export class Stock {
  private dataServices = inject(DataServices);

  // HU-04: inactive products are hidden
  products = signal<ProductListItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  query = signal('');
  category = signal(''); // '' = all
  onlyLow = signal(false); // only Agotado / Por acabarse

  categories = computed(() =>
    [...new Set(this.products().map((p) => this.categoryName(p)))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    ),
  );

  // HU-03 matching: every typed word must appear in the name or the code, ignoring accents
  shown = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    const category = this.category();
    const onlyLow = this.onlyLow();
    return this.products()
      .filter((product) => {
        if (category && this.categoryName(product) !== category) return false;
        if (onlyLow && this.estado(product).rank === 2) return false;
        const text = this.normalize(`${product.nombre} ${product.codigo}`);
        return words.every((word) => text.includes(word));
      })
      .sort(
        (a, b) =>
          this.estado(a).rank - this.estado(b).rank || a.nombre.localeCompare(b.nombre, 'es'),
      );
  });

  lowCount = computed(() => this.products().filter((p) => this.estado(p).rank < 2).length);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-08: "(1.5 cajas)" next to the stock
  readonly pres = injectPresentations();

  constructor() {
    this.dataServices.getProducts().subscribe({
      next: (products) => {
        this.products.set(products.filter((p) => p.activo));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las existencias');
        this.loading.set(false);
      },
    });
  }

  categoryName(product: ProductListItem): string {
    return product.categoria ?? 'Sin categoría';
  }

  // Same rules as the products list and the dashboard (HU-21, HU-22)
  estado(product: ProductListItem): Estado {
    if (product.existencia <= 0) {
      return { label: 'Agotado', rank: 0, classes: 'bg-red-100 text-red-800' };
    }
    if (product.stock_minimo !== null && product.existencia <= product.stock_minimo) {
      return { label: 'Por acabarse', rank: 1, classes: 'bg-yellow-100 text-yellow-800' };
    }
    return { label: 'Disponible', rank: 2, classes: 'bg-green-100 text-green-800' };
  }

  // HU-07: whole numbers for "unidad", up to 2 decimals for lb, m and gal
  cantidadFormat(product: ProductListItem): string {
    return product.unidad_base === 'unidad' ? '1.0-0' : '1.0-2';
  }

  clearFilters() {
    this.query.set('');
    this.category.set('');
    this.onlyLow.set(false);
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }
}
