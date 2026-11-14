import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { NewOutput, Output, OutputTipo } from '../../models/output';
import { ProductListItem, UnidadBase } from '../../models/product';

// The texts that change between the two kinds of output
interface TipoTexts {
  label: string; // badge in the list
  title: string;
  motivoLabel: string;
  motivoPlaceholder: string;
  button: string;
  done: string; // "Daño registrado"
  pickError: string;
}

// HU-16 (merma) and HU-17 (uso interno): take out of stock what broke or what the store used,
// always in the base unit. HU-18: it never lets the stock go below zero
@Component({
  imports: [ReactiveFormsModule, DatePipe, DecimalPipe],
  selector: 'app-outputs',
  templateUrl: './outputs.html',
})
export class Outputs {
  private dataServices = inject(DataServices);
  private fb = inject(FormBuilder);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  readonly texts: Record<OutputTipo, TipoTexts> = {
    dano: {
      label: 'Daño',
      title: 'Producto dañado',
      motivoLabel: 'Motivo',
      motivoPlaceholder: 'Se rompió el saco al bajarlo del camión',
      button: 'Registrar daño',
      done: 'Daño registrado',
      pickError: 'Elija el producto que se dañó',
    },
    uso: {
      label: 'Uso interno',
      title: 'Uso interno',
      motivoLabel: '¿Para qué se usó?',
      motivoPlaceholder: 'Reparar la tubería del baño',
      button: 'Registrar uso interno',
      done: 'Uso interno registrado',
      pickError: 'Elija el producto que se usó',
    },
  };

  // What is being registered (the Daño | Uso interno buttons)
  tipo = signal<OutputTipo>('dano');
  t = computed(() => this.texts[this.tipo()]);

  // List filter: null = both
  listFilter = signal<OutputTipo | null>(null);
  readonly filterOptions: { value: OutputTipo | null; label: string }[] = [
    { value: null, label: 'Todos' },
    { value: 'dano', label: this.texts.dano.label },
    { value: 'uso', label: this.texts.uso.label },
  ];
  shownOutputs = computed(() => {
    const filter = this.listFilter();
    return filter ? this.outputs().filter((o) => o.tipo === filter) : this.outputs();
  });

  products = signal<ProductListItem[]>([]);
  outputs = signal<Output[]>([]);
  loadingOutputs = signal(true);

  saving = signal(false);
  error = signal<string | null>(null);
  created = signal<string | null>(null);

  // Product search (HU-03): what is typed and the product picked
  query = signal('');
  selectedId = signal<number | null>(null);
  selected = computed(() => this.products().find((p) => p.id === this.selectedId()) ?? null);

  // HU-04: inactive products cannot be taken out. Max 8 results so the list stays short
  results = computed(() => {
    const words = this.normalize(this.query()).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    return this.products()
      .filter((product) => {
        if (!product.activo) {
          return false;
        }
        const text = this.normalize(`${product.nombre} ${product.codigo}`);
        return words.every((word) => text.includes(word));
      })
      .slice(0, 8);
  });

  form = this.fb.group({
    cantidad: [null as number | null, [Validators.required, Validators.min(0)]],
    motivo: ['', [Validators.required, Validators.maxLength(200)]],
  });

  constructor() {
    // From the "Sacar" button in Productos: /content/outputs?producto=5
    const fromProducts = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('producto'));

    this.dataServices.getProducts().subscribe({
      next: (products) => {
        this.products.set(products);
        if (fromProducts) {
          const product = products.find((p) => p.id === fromProducts && p.activo);
          if (product) {
            this.pick(product);
          }
        }
      },
      error: () => this.error.set('No se pudieron cargar los productos'),
    });
    this.loadOutputs();
  }

  private loadOutputs() {
    this.dataServices.getOutputs().subscribe({
      next: (outputs) => {
        this.outputs.set(outputs);
        this.loadingOutputs.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las salidas');
        this.loadingOutputs.set(false);
      },
    });
  }

  setTipo(tipo: OutputTipo) {
    this.tipo.set(tipo);
    this.error.set(null);
    this.created.set(null);
  }

  pick(product: ProductListItem) {
    this.selectedId.set(product.id);
    this.query.set('');
    this.error.set(null);
  }

  // Enter in the search box picks the first result
  pickFirst(event: Event) {
    event.preventDefault();
    const first = this.results()[0];
    if (first) {
      this.pick(first);
    }
  }

  clearProduct() {
    this.selectedId.set(null);
  }

  // "4 u", "49.75 lb"
  amount(value: number, unidad: UnidadBase): string {
    const decimals = unidad === 'unidad' ? 0 : 3;
    return `${+value.toFixed(decimals)} ${this.unidadLabel[unidad]}`;
  }

  // HU-18: the same text Flask's 409 turns into
  stockMessage(product: ProductListItem, existencia = product.existencia): string {
    return `Solo hay ${this.amount(existencia, product.unidad_base)} en existencia`;
  }

  // Checked while typing, before going to Flask
  get quantityProblem(): string | null {
    const product = this.selected();
    const cantidad = this.form.controls.cantidad.value;
    if (!product || cantidad == null || cantidad === 0) {
      return null;
    }
    if (cantidad < 0) {
      return 'La cantidad debe ser mayor que 0';
    }
    // HU-07: by unit only whole numbers
    if (product.unidad_base === 'unidad' && !Number.isInteger(cantidad)) {
      return 'Este producto es por unidad: solo cantidades enteras';
    }
    if (product.unidad_base !== 'unidad' && !Number.isInteger(+(cantidad * 1000).toFixed(6))) {
      return 'Máximo 3 decimales';
    }
    if (cantidad > product.existencia) {
      return this.stockMessage(product);
    }
    return null;
  }

  invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  save() {
    this.error.set(null);
    this.created.set(null);

    const product = this.selected();
    if (!product) {
      this.error.set(this.t().pickError);
      return;
    }
    const { cantidad, motivo } = this.form.getRawValue();
    if (this.form.invalid || !cantidad || cantidad <= 0 || !motivo?.trim()) {
      this.form.markAllAsTouched();
      if (!cantidad || cantidad <= 0) {
        this.error.set('La cantidad debe ser mayor que 0');
      }
      return;
    }
    if (this.quantityProblem) {
      this.error.set(this.quantityProblem);
      return;
    }

    const output: NewOutput = {
      tipo: this.tipo(),
      producto_id: product.id,
      cantidad,
      motivo: motivo.trim(),
    };

    this.saving.set(true);
    this.dataServices.addOutput(output).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.created.set(
          `${this.texts[saved.tipo].done}: ${this.amount(saved.cantidad, saved.unidad_base)} de ${saved.producto}`,
        );
        this.outputs.update((list) => [saved, ...list]);
        // The stock went down: update it here without asking Flask again
        this.products.update((list) =>
          list.map((p) => (p.id === product.id ? { ...p, existencia: p.existencia - saved.cantidad } : p)),
        );
        this.form.reset();
        this.selectedId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409 && err.error?.data?.existencia !== undefined) {
          // HU-18: someone else took some in the meantime. Show the real stock and keep it updated
          const existencia: number = err.error.data.existencia;
          this.products.update((list) =>
            list.map((p) => (p.id === product.id ? { ...p, existencia } : p)),
          );
          this.error.set(this.stockMessage(product, existencia));
          return;
        }
        this.error.set(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'No se pudo conectar con el servidor';
      case 404:
        return 'Ese producto ya no existe';
      default:
        // 401 is handled by the auth-interceptor (sends you to login)
        return err.error?.message || 'No se pudo registrar la salida';
    }
  }

  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
