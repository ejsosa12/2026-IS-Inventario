import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DataServices } from '../../core/services/data-services';
import { ProductListItem, UnidadBase } from '../../models/product';

interface Estado {
  label: string;
  classes: string;
}

@Component({
  imports: [DecimalPipe],
  selector: 'app-products',
  templateUrl: './products.html',
})
export class Products {
  private dataServices = inject(DataServices);

  products = signal<ProductListItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm' };

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

  // Products by unit show whole numbers, by lb or m up to 2 decimals (HU-07)
  cantidadFormat(product: ProductListItem): string {
    return product.unidad_base === 'unidad' ? '1.0-0' : '1.0-2';
  }
}
