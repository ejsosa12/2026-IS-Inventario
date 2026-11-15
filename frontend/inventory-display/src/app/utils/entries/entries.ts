import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { negativeStockMessage } from '../../core/utils/negative-stock';
import {
  CorrectEntry,
  Entry,
  EntryItem,
  NewEntry,
  NewEntryItem,
  Presentation,
} from '../../models/entry';
import { ProductListItem, UnidadBase } from '../../models/product';
import { Supplier } from '../../models/supplier';

// One choice of the "Viene en" select: a presentation or the base unit (presentacion_id null)
interface UnitOption {
  presentacion_id: number | null;
  label: string;
  factor: number;
}

// A product already added to the invoice, with what the table needs to show it
interface EntryLine {
  item: NewEntryItem;
  codigo: string;
  nombre: string;
  unidad: string; // "caja (50 lb)" or "lb"
  factor: number;
  unidadBase: string;
}

// Today as YYYY-MM-DD in local time (toISOString would use UTC and can give tomorrow)
function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

@Component({
  imports: [ReactiveFormsModule, DecimalPipe, RouterLink],
  selector: 'app-entries',
  templateUrl: './entries.html',
})
export class Entries {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);
  private router = inject(Router);

  // HU-14: entries/correct/:id opens this same form filled with that entry (null = new entry)
  readonly correctId: number | null = (() => {
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id');
    return id === null ? null : Number(id);
  })();

  // HU-14: the entry being corrected, and why (required to save the correction)
  original = signal<Entry | null>(null);
  motivo = this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(200)]);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };
  readonly maxDate = today();

  suppliers = signal<Supplier[]>([]);
  products = signal<ProductListItem[]>([]);
  presentations = signal<Presentation[]>([]);

  lines = signal<EntryLine[]>([]);
  lineError = signal<string | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  // HU-09: a deactivated supplier does not receive new invoices.
  // HU-14: a correction may keep the supplier of the original even if it was deactivated
  supplierOptions = computed(() =>
    this.suppliers().filter(
      (supplier) => supplier.activo || supplier.id === this.original()?.proveedor_id,
    ),
  );

  // HU-04: products taken off the catalog do not receive stock (same exception as above)
  productOptions = computed(() => {
    const kept = new Set(this.original()?.productos.map((item) => item.producto_id));
    return this.products().filter((product) => product.activo || kept.has(product.id));
  });

  // Invoice total, using what the invoice says (to compare with the paper)
  total = computed(() =>
    this.lines().reduce(
      (sum, line) => sum + (line.item.cantidad_factura ?? line.item.cantidad) * line.item.precio,
      0,
    ),
  );

  // HU-12: lines where less (or more) arrived than the invoice says
  shortages = computed(() => this.lines().filter((line) => this.isShortage(line)).length);

  // Invoice header (HU-11)
  form = this.fb.group({
    proveedor_id: [null as number | null, Validators.required],
    numero_factura: ['', [Validators.required, Validators.maxLength(30)]],
    fecha_factura: [today(), Validators.required],
  });

  // The product being added right now
  lineForm = this.fb.group({
    producto_id: [null as number | null, Validators.required],
    presentacion_id: [null as number | null],
    cantidad: [null as number | null, [Validators.required, Validators.min(0)]],
    cantidad_factura: [null as number | null, Validators.min(0)],
    precio: [null as number | null, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    this.dataServices.getSuppliers().subscribe({
      next: (suppliers) => this.suppliers.set(suppliers),
      error: () => this.error.set('No se pudieron cargar los proveedores'),
    });
    this.dataServices.getProducts().subscribe({
      next: (products) => this.products.set(products),
      error: () => this.error.set('No se pudieron cargar los productos'),
    });
    this.dataServices.getPresentations().subscribe({
      next: (presentations) => this.presentations.set(presentations),
      error: () => this.error.set('No se pudieron cargar las presentaciones'),
    });

    if (this.correctId !== null) {
      this.loadOriginal(this.correctId);
    }

    // When the product changes, suggest its biggest presentation (how it usually comes)
    this.lineForm.controls.producto_id.valueChanges.subscribe((productId) => {
      const options = this.unitOptions(productId);
      this.lineForm.controls.presentacion_id.setValue(options[0]?.presentacion_id ?? null);
    });
  }

  // HU-14: fills the header and the lines with the entry, as it came on the invoice
  private loadOriginal(id: number) {
    this.dataServices.getEntry(id).subscribe({
      next: (entry) => {
        if (entry.anulada) {
          this.error.set('Esta entrada ya fue anulada, no se puede corregir');
          return;
        }
        this.original.set(entry);
        this.form.reset({
          proveedor_id: entry.proveedor_id,
          numero_factura: entry.numero_factura,
          fecha_factura: entry.fecha_factura,
        });
        this.lines.set(entry.productos.map((item) => this.lineFromItem(item)));
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(
          err.status === 404 ? 'Esa entrada no existe' : 'No se pudo cargar la entrada a corregir',
        ),
    });
  }

  // A saved product back into a line of the table, with the values of the invoice
  private lineFromItem(item: EntryItem): EntryLine {
    const base = this.unidadLabel[item.unidad_base];
    return {
      item: {
        producto_id: item.producto_id,
        presentacion_id: item.presentacion_id,
        cantidad: item.cantidad_presentacion,
        // null = the same as received, like when it was typed
        cantidad_factura: item.faltante ? item.cantidad_factura_presentacion : null,
        precio: item.precio_presentacion,
      },
      codigo: item.codigo,
      nombre: item.nombre,
      unidad: item.presentacion ? `${item.presentacion} (${item.factor} ${base})` : base,
      factor: item.factor,
      unidadBase: base,
    };
  }

  // "2026-11-09" -> "09/11/2026" (not DatePipe, it would read it as UTC)
  invoiceDate(iso: string): string {
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  private product(productId: number | null): ProductListItem | undefined {
    return this.products().find((product) => product.id === productId);
  }

  // HU-06: the presentations of the product, biggest first, plus the base unit
  unitOptions(productId: number | null): UnitOption[] {
    const product = this.product(productId);
    if (!product) {
      return [];
    }
    const base = this.unidadLabel[product.unidad_base];
    const presentations = this.presentations()
      .filter((presentation) => presentation.producto_id === product.id)
      .sort((a, b) => b.factor - a.factor)
      .map((presentation) => ({
        presentacion_id: presentation.id,
        label: `${presentation.nombre} (${presentation.factor} ${base})`,
        factor: presentation.factor,
      }));
    // Without presentations it only comes in the base unit: "unidad" reads better than "u (suelto)"
    const baseLabel = presentations.length
      ? `${base} (suelto)`
      : product.unidad_base === 'unidad'
        ? 'unidad'
        : base;
    return [...presentations, { presentacion_id: null, label: baseLabel, factor: 1 }];
  }

  // The option picked right now in the line form
  private selectedUnit(): UnitOption | undefined {
    const { producto_id, presentacion_id } = this.lineForm.getRawValue();
    return this.unitOptions(producto_id).find(
      (option) => option.presentacion_id === presentacion_id,
    );
  }

  // "= 100 lb" next to the quantity, so the user sees what goes into stock
  get baseQuantityHint(): string | null {
    const { producto_id, cantidad } = this.lineForm.getRawValue();
    const product = this.product(producto_id);
    const unit = this.selectedUnit();
    if (!product || !unit || unit.factor === 1 || !cantidad) {
      return null;
    }
    return `= ${+(cantidad * unit.factor).toFixed(3)} ${this.unidadLabel[product.unidad_base]}`;
  }

  // Shows the red message only after the user touched the field
  invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  isShortage(line: EntryLine): boolean {
    return line.item.cantidad_factura !== null && line.item.cantidad_factura !== line.item.cantidad;
  }

  addLine() {
    this.lineError.set(null);
    this.created.set(null);

    const value = this.lineForm.getRawValue();
    const product = this.product(value.producto_id);
    const unit = this.selectedUnit();

    if (!product || !unit) {
      this.lineError.set('Elija un producto');
      return;
    }
    // HU-12: if nothing arrived the product is not entered
    if (value.cantidad == null || value.cantidad <= 0) {
      this.lineError.set('La cantidad recibida debe ser mayor que 0');
      return;
    }
    if (value.cantidad_factura != null && value.cantidad_factura < 0) {
      this.lineError.set('La cantidad en factura no puede ser negativa');
      return;
    }
    if (value.precio == null || value.precio < 0) {
      this.lineError.set('Ingrese el precio de 0 o más');
      return;
    }
    // HU-07: same rule Flask checks. By unit only whole numbers once converted
    if (product.unidad_base === 'unidad') {
      const quantities = [value.cantidad, value.cantidad_factura].filter((q) => q != null);
      if (quantities.some((q) => !Number.isInteger(+(q! * unit.factor).toFixed(3)))) {
        this.lineError.set('Este producto se vende por unidad: solo cantidades enteras');
        return;
      }
    }

    const line: EntryLine = {
      item: {
        producto_id: product.id,
        presentacion_id: unit.presentacion_id,
        cantidad: value.cantidad,
        cantidad_factura: value.cantidad_factura ?? null,
        precio: value.precio,
      },
      codigo: product.codigo,
      nombre: product.nombre,
      unidad: unit.label,
      factor: unit.factor,
      unidadBase: this.unidadLabel[product.unidad_base],
    };
    this.lines.update((lines) => [...lines, line]);
    this.lineForm.reset();
  }

  removeLine(index: number) {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  save() {
    this.error.set(null);
    this.created.set(null);

    if (this.correctId !== null && !this.original()) {
      return;
    }
    if (this.form.invalid || (this.correctId !== null && this.motivo.invalid)) {
      this.form.markAllAsTouched();
      this.motivo.markAsTouched();
      return;
    }
    if (this.lines().length === 0) {
      this.error.set('Agregue al menos un producto a la entrada');
      return;
    }

    const value = this.form.getRawValue();
    const entry: NewEntry = {
      proveedor_id: value.proveedor_id!,
      numero_factura: value.numero_factura!.trim(),
      fecha_factura: value.fecha_factura!,
      productos: this.lines().map((line) => line.item),
    };

    this.saving.set(true);
    if (this.correctId !== null) {
      this.saveCorrection(this.correctId, { ...entry, motivo: this.motivo.value.trim() });
      return;
    }
    this.dataServices.addEntry(entry).subscribe({
      next: (created) => {
        this.saving.set(false);
        const shortages = created.productos.filter((item) => item.faltante).length;
        this.created.set(
          `Factura ${created.numero_factura} de ${created.proveedor} ingresada` +
            (shortages ? ` · ${shortages} producto(s) con faltantes` : ''),
        );
        this.lines.set([]);
        this.form.reset({ fecha_factura: today() });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.errorMessage(err));
      },
    });
  }

  // HU-14: the original is voided and this one saved, in one step. Then back to the list
  private saveCorrection(id: number, entry: CorrectEntry) {
    this.dataServices.correctEntry(id, entry).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.router.navigate(['/content/entries-list'], {
          state: { notice: `Factura ${created.numero_factura} de ${created.proveedor} corregida` },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'No se pudo conectar con el servidor';
      case 403:
        return 'Solo el dueño puede corregir entradas';
      case 409:
        // HU-14 + HU-18: the correction would leave a product below 0
        if (err.error?.data?.productos) {
          return (
            `No se puede guardar: ${negativeStockMessage(err.error.data.productos)}. ` +
            'Revise las cantidades o las salidas registradas de ese producto.'
          );
        }
        return 'Esta factura de este proveedor ya fue ingresada';
      default:
        if (err.error?.message === 'entry is already voided') {
          return 'Esta entrada ya fue anulada (quizá alguien más la corrigió)';
        }
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo guardar la entrada';
    }
  }
}
