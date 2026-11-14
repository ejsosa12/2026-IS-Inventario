import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { LowStockItem, UnidadBase } from '../../models/product';

// sessionStorage key: the user closed the HU-22 notification. AuthService.logout() clears it
const DISMISSED_KEY = 'lowStockDismissed';

// The first page after logging in. HU-22: it says right away what is running out
@Component({
  imports: [RouterLink],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private dataServices = inject(DataServices);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  // Out of stock first, then furthest from the minimum (Flask sorts them)
  lowStock = signal<LowStockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  outOfStock = computed(() => this.lowStock().filter((p) => p.agotado).length);

  // The "X" of the notification: stays closed until the user logs out
  dismissed = signal(sessionStorage.getItem(DISMISSED_KEY) === '1');

  dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    this.dismissed.set(true);
  }

  constructor() {
    this.dataServices.getLowStock().subscribe({
      next: (items) => {
        this.lowStock.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo revisar qué se está acabando');
        this.loading.set(false);
      },
    });
  }

  // "4 u", "12.5 lb"
  amount(value: number, unidad: UnidadBase): string {
    const decimals = unidad === 'unidad' ? 0 : 3;
    return `${+value.toFixed(decimals)} ${this.unidadLabel[unidad]}`;
  }

  // 1 producto / 5 productos
  plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }
}
