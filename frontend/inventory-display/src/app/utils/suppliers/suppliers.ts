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

  // HU-29: the "Agregar", "Editar" and "Desactivar" buttons are only for the owner
  isAdmin = inject(AuthService).isAdmin;

  suppliers = signal<Supplier[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  // The supplier being activated/deactivated right now (disables its button)
  busyId = signal<number | null>(null);
  actionError = signal<string | null>(null);

  // Same search as products: every word must appear in the name, contact, phone or NIT
  filtered = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return this.suppliers();
    }
    return this.suppliers().filter((supplier) => {
      const text = this.normalize(`${supplier.nombre} ${supplier.contacto ?? ''} ${supplier.telefono ?? ''} ${supplier.nit ?? ''}`);
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

  // HU-09: deactivate (asks first) or reactivate a supplier
  toggleActive(supplier: Supplier) {
    const activo = !supplier.activo;
    if (
      !activo &&
      !confirm(`¿Desactivar a ${supplier.nombre}? Ya no se le podrán ingresar facturas nuevas.`)
    ) {
      return;
    }
    this.actionError.set(null);
    this.busyId.set(supplier.id);
    this.dataServices.setSupplierStatus(supplier.id, activo).subscribe({
      next: (updated) => {
        this.suppliers.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
        this.busyId.set(null);
      },
      error: (err) => {
        this.actionError.set(
          err.status === 403
            ? 'Solo el dueño puede desactivar proveedores'
            : 'No se pudo cambiar el estado del proveedor',
        );
        this.busyId.set(null);
      },
    });
  }

  // "Eléctrica CENTRO" -> "electrica centro"
  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
