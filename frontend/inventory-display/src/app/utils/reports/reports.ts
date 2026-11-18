import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';
import { UnidadBase } from '../../models/product';
import {
  InventoryValue,
  InventoryValueCategory,
  InventoryValueProduct,
} from '../../models/report';

type CategorySortKey = 'categoria' | 'productos' | 'valor';
type ProductSortKey = 'nombre' | 'categoria' | 'existencia' | 'precio_compra' | 'valor';

// "Análisis": the owner's money reports (adminGuard + Flask 403).
// HU-26: how much money is in the store = stock × purchase price, in total and per category.
@Component({
  imports: [RouterLink, DecimalPipe],
  selector: 'app-reports',
  templateUrl: './reports.html',
})
export class Reports {
  private dataServices = inject(DataServices);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-08: "(1.5 cajas)" next to quantities, for products bought in a presentation

  readonly pres = injectPresentations();

  report = signal<InventoryValue | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // null = Flask's order (most valuable first)
  categorySort = signal<SortState<CategorySortKey> | null>(null);
  productSort = signal<SortState<ProductSortKey> | null>(null);

  // Filter of the product table ('' = all). Clicking a category row also sets it
  category = signal('');

  categories = computed(() =>
    sortList(this.report()?.por_categoria ?? [], this.categorySort(), (item, key) =>
      key === 'categoria' ? this.categoryName(item) : item[key],
    ),
  );

  categoryOptions = computed(() =>
    (this.report()?.por_categoria ?? [])
      .map((c) => this.categoryName(c))
      .sort((a, b) => a.localeCompare(b, 'es')),
  );

  products = computed(() => {
    const category = this.category();
    const list = (this.report()?.productos ?? []).filter(
      (p) => !category || this.categoryName(p) === category,
    );
    return sortList(list, this.productSort(), (item, key) =>
      key === 'categoria' ? this.categoryName(item) : item[key],
    );
  });

  // Total of what the product table shows (all, or one category)
  shownTotal = computed(() => this.products().reduce((sum, p) => sum + (p.valor ?? 0), 0));

  constructor() {
    this.dataServices.getInventoryValue().subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(
          err.status === 403
            ? 'Solo el dueño puede ver cuánto dinero hay en bodega'
            : err.status === 0
              ? 'No se pudo conectar con el servidor'
              : 'No se pudo calcular el valor del inventario',
        );
        this.loading.set(false);
      },
    });
  }

  sortCategories(key: CategorySortKey) {
    this.categorySort.update((current) => nextSort(current, key));
  }

  sortProducts(key: ProductSortKey) {
    this.productSort.update((current) => nextSort(current, key));
  }

  categoryIcon(key: CategorySortKey) {
    return sortIcon(this.categorySort(), key);
  }

  productIcon(key: ProductSortKey) {
    return sortIcon(this.productSort(), key);
  }

  categoryAria(key: CategorySortKey) {
    return ariaSort(this.categorySort(), key);
  }

  productAria(key: ProductSortKey) {
    return ariaSort(this.productSort(), key);
  }

  // Click a category: show only its products (click again to show all)
  pickCategory(item: InventoryValueCategory) {
    const name = this.categoryName(item);
    this.category.update((current) => (current === name ? '' : name));
  }

  categoryName(item: { categoria: string | null }): string {
    return item.categoria ?? 'Sin categoría';
  }

  // "2550 m", "12.5 lb"
  amount(product: InventoryValueProduct): string {
    return `${+product.existencia.toFixed(3)} ${this.unidadLabel[product.unidad_base]}`;
  }

  // 1 producto / 5 productos
  plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }
}
