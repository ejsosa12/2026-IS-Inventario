import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';
import { DataServices } from '../../core/services/data-services';
import { Supplier } from '../../models/supplier';

@Component({
  imports: [RouterLink],
  selector: 'app-suppliers',
  templateUrl: './suppliers.html',
})
export class Suppliers {
  private dataServices = inject(DataServices);

  // HU-29: the "Agregar" button is only for the owner
  isAdmin = inject(AuthService).isAdmin;

  suppliers = signal<Supplier[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  // Same search as products: every word must appear in the name, phone or NIT
  filtered = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return this.suppliers();
    }
    return this.suppliers().filter((supplier) => {
      const text = this.normalize(`${supplier.nombre} ${supplier.telefono ?? ''} ${supplier.nit ?? ''}`);
      return words.every((word) => text.includes(word));
    });
  });

  constructor() {
    this.dataServices.getSuppliers().subscribe({
      next: (suppliers) => {
        this.suppliers.set(suppliers);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los proveedores');
        this.loading.set(false);
      },
    });
  }

  // "Eléctrica CENTRO" -> "electrica centro"
  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
