import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { DataServices } from '../../core/services/data-services';
import { InitialLoadResult, InitialLoadRow } from '../../models/initial-load';
import { UnidadBase } from '../../models/product';

// HU-31 (owner only, adminGuard): load what the store already has from Excel.
// 1) download the template, 2) upload it: Flask checks every row and saves nothing,
// 3) "Guardar" only when there are no errors; Flask checks again and saves all or nothing.
// Each product with stock gets an 'inicial' movement ("Inventario inicial" in the kárdex).
@Component({
  imports: [RouterLink, DecimalPipe],
  selector: 'app-initial-load',
  styleUrl: './initial-load.css',
  templateUrl: './initial-load.html',
})
export class InitialLoad {
  private dataServices = inject(DataServices);

  readonly unidadLabel: Record<UnidadBase, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

  file = signal<File | null>(null);
  result = signal<InitialLoadResult | null>(null);
  saved = signal(false); // the result on screen is what was saved
  checking = signal(false);
  saving = signal(false);
  downloading = signal(false);
  error = signal<string | null>(null);
  onlyErrors = signal(false);

  rows = computed(() => {
    const rows = this.result()?.filas ?? [];
    return this.onlyErrors() ? rows.filter((r) => r.errores.length) : rows;
  });
  canSave = computed(() => {
    const result = this.result();
    return !!result && !this.saved() && result.resumen.con_error === 0 && !!this.file();
  });

  downloadTemplate() {
    this.error.set(null);
    this.downloading.set(true);
    this.dataServices.getInitialLoadTemplate().subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plantilla-inventario-inicial.xlsx';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.downloading.set(false);
        this.error.set(
          err.status === 0 ? 'No se pudo conectar con el servidor' : 'No se pudo descargar la plantilla',
        );
      },
    });
  }

  // Picking a file checks it right away
  pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Lets the same file be picked again after fixing it in Excel
    input.value = '';
    if (!file) {
      return;
    }
    this.file.set(file);
    this.check();
  }

  check() {
    const file = this.file();
    if (!file) {
      return;
    }
    this.error.set(null);
    this.saved.set(false);
    this.result.set(null);
    this.onlyErrors.set(false);
    this.checking.set(true);
    this.dataServices.previewInitialLoad(file).subscribe({
      next: (result) => {
        this.checking.set(false);
        this.result.set(result);
        this.onlyErrors.set(result.resumen.con_error > 0);
      },
      error: (err: HttpErrorResponse) => {
        this.checking.set(false);
        this.error.set(this.errorMessage(err, 'No se pudo revisar el archivo'));
      },
    });
  }

  save() {
    const file = this.file();
    const result = this.result();
    if (!file || !result || !this.canSave() || this.saving()) {
      return;
    }
    const { nuevos, existentes, valor } = result.resumen;
    const parts = [];
    if (nuevos) {
      parts.push(`se van a crear ${nuevos} ${nuevos === 1 ? 'producto' : 'productos'}`);
    }
    if (existentes) {
      parts.push(`se va a cargar la existencia de ${existentes} ${existentes === 1 ? 'producto que ya existía' : 'productos que ya existían'}`);
    }
    const text = parts.join(' y ');
    if (
      !confirm(
        `${text.charAt(0).toUpperCase() + text.slice(1)}, por un valor de Q${valor.toFixed(2)}.\n\n` +
          'Queda como "Inventario inicial" en el historial. ¿Continuar?',
      )
    ) {
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    this.dataServices.saveInitialLoad(file).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.result.set(saved);
        this.saved.set(true);
        this.onlyErrors.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 400 && err.error?.data?.filas) {
          // Something changed since it was checked: show the new errors
          this.result.set(err.error.data);
          this.onlyErrors.set(true);
          this.error.set('El archivo tiene errores. No se guardó nada');
        } else if (err.status === 409) {
          const codigos: string[] = err.error?.data?.codigos ?? [];
          this.error.set(
            codigos.length
              ? `Mientras revisaba, se registraron movimientos de ${codigos.join(', ')}. No se guardó nada`
              : 'Mientras revisaba, alguien creó un producto con uno de esos códigos. No se guardó nada',
          );
          this.check();
        } else {
          this.error.set(this.errorMessage(err, 'No se pudo guardar'));
        }
      },
    });
  }

  reset() {
    this.file.set(null);
    this.result.set(null);
    this.saved.set(false);
    this.error.set(null);
  }

  // Flask writes the file problems in Spanish ("Faltan las columnas: ...")
  private errorMessage(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) {
      return 'No se pudo conectar con el servidor';
    }
    if (err.status === 403) {
      return 'Solo el dueño puede cargar el inventario inicial';
    }
    if (err.status === 413) {
      return 'El archivo es demasiado grande';
    }
    return err.status === 400 && err.error?.message ? err.error.message : fallback;
  }

  quantity(row: InitialLoadRow): string {
    if (row.existencia === null) {
      return '—';
    }
    const unit = row.unidad_base ? ` ${this.unidadLabel[row.unidad_base]}` : '';
    return `${(+row.existencia.toFixed(3)).toLocaleString('es-GT', { maximumFractionDigits: 3 })}${unit}`;
  }
}
