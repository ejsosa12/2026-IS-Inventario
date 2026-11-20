import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { injectPresentations } from '../../core/utils/two-units';
import { ProductListItem, UnidadBase } from '../../models/product';
import { ariaSort, nextSort, sortIcon, sortList, SortState } from '../../core/utils/sort';

// Columns that can be sorted by clicking their title
type ProductSortKey =
  'codigo' | 'nombre' | 'categoria' | 'precio' | 'existencia' | 'stock_minimo' | 'estado';

interface Estado {
  label: string;
  classes: string;
}

@Component({
  imports: [DecimalPipe, RouterLink],
  selector: 'app-products',
  templateUrl: './products.html',
})
export class Products {
  private dataServices = inject(DataServices);

  // HU-29: the "Agregar" button is only for the owner
  isAdmin = inject(AuthService).isAdmin;

  products = signal<ProductListItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  // HU-04: the row being (de)activated and the error of that action
  busyId = signal<number | null>(null);
  actionError = signal<string | null>(null);

  // HU-05: filter by category ('' = all). The options are the categories that have products
  category = signal('');
  categories = computed(() =>
    [...new Set(this.products().map((p) => this.categoryName(p)))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    ),
  );

  // null = the order Flask sent (by name)
  sort = signal<SortState<ProductSortKey> | null>(null);

  // HU-03: every word typed must appear in the name or the code, in any order.
  // "tubo 1/2" finds "Tubo PVC 1/2\" x 6 m". Case and accents do not matter.
  filtered = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    const category = this.category();
    return this.products().filter((product) => {
      if (category && this.categoryName(product) !== category) {
        return false;
      }
      if (words.length === 0) {
        return true;
      }
      // HU-04: inactive products do not show up in searches
      if (!product.activo) {
        return false;
      }
      const text = this.normalize(`${product.nombre} ${product.codigo}`);
      return words.every((word) => text.includes(word));
    });
  });

  // What the table shows: filtered, then sorted by the clicked column
  shown = computed(() =>
    sortList(this.filtered(), this.sort(), (product, key) => this.sortValue(product, key)),
  );

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // HU-08: "(1.5 cajas)" next to quantities, for products bought in a presentation

  readonly pres = injectPresentations();

  constructor() {
    this.dataServices.getProducts().subscribe({
      next: (products) => {
        this.products.set(products);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los productos');
        this.loading.set(false);
      },
    });
  }

  // HU-04: soft delete. It may still have stock (decided 2026-11-20, option A), so warn about it
  toggleActive(product: ProductListItem) {
    const activo = !product.activo;
    if (!activo) {
      let message =
        `¿Desactivar ${product.nombre}?\n\n` +
        'Ya no aparecerá en búsquedas, entradas, salidas ni ventas. Su historial se conserva ' +
        'y se puede volver a activar.';
      if (product.existencia > 0) {
        const cantidad = Number(product.existencia.toFixed(product.unidad_base === 'unidad' ? 0 : 2));
        message +=
          `\n\nTodavía hay ${cantidad} ${this.unidadLabel[product.unidad_base]} en existencia; ` +
          'ya no se podrán vender ni sacar mientras esté inactivo.';
      }
      if (!confirm(message)) {
        return;
      }
    }
    this.actionError.set(null);
    this.busyId.set(product.id);
    this.dataServices.setProductStatus(product.id, activo).subscribe({
      next: (updated) => {
        this.products.update((list) =>
          list.map((p) => (p.id === updated.id ? { ...p, activo: updated.activo } : p)),
        );
        this.busyId.set(null);
      },
      error: (err) => {
        this.actionError.set(
          err.status === 403
            ? 'Solo el dueño puede desactivar productos'
            : 'No se pudo cambiar el estado del producto',
        );
        this.busyId.set(null);
      },
    });
  }

  sortBy(key: ProductSortKey) {
    this.sort.update((current) => nextSort(current, key));
  }

  sortIcon(key: ProductSortKey): string {
    return sortIcon(this.sort(), key);
  }

  ariaSort(key: ProductSortKey) {
    return ariaSort(this.sort(), key);
  }

  categoryName(product: ProductListItem): string {
    return product.categoria ?? 'Sin categoría';
  }

  private sortValue(product: ProductListItem, key: ProductSortKey): string | number | null {
    switch (key) {
      case 'categoria':
        return this.categoryName(product);
      case 'estado':
        // Agotado, Por acabarse, Disponible, Inactivo: the urgent ones first
        return ['Agotado', 'Por acabarse', 'Disponible', 'Inactivo'].indexOf(
          this.estado(product).label,
        );
      default:
        return product[key];
    }
  }

  // "Cemento GRIS" -> "cemento gris", "Plomería" -> "plomeria"
  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // HU-04, HU-21, HU-22: the badge on each row
  estado(product: ProductListItem): Estado {
    if (!product.activo) {
      return { label: 'Inactivo', classes: 'bg-gray-100 text-gray-600' };
    }
    if (product.existencia <= 0) {
      return { label: 'Agotado', classes: 'bg-red-100 text-red-800' };
    }
    if (product.stock_minimo !== null && product.existencia <= product.stock_minimo) {
      return { label: 'Por acabarse', classes: 'bg-yellow-100 text-yellow-800' };
    }
    return { label: 'Disponible', classes: 'bg-green-100 text-green-800' };
  }

  // Products by unit show whole numbers, by lb, m or gal up to 2 decimals (HU-07)
  cantidadFormat(product: ProductListItem): string {
    return product.unidad_base === 'unidad' ? '1.0-0' : '1.0-2';
  }
}
