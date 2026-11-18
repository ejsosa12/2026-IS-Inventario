import { inject, signal } from '@angular/core';
import { DataServices } from '../services/data-services';
import { Presentation } from '../../models/entry';

// HU-08: "75 lb (1.5 cajas)". Shows a quantity in the product's biggest presentation (HU-06),
// only for products that have one and only when the quantity is not 0 (decided 2026-11-17).

// "caja" → "cajas", "rollo" → "rollos", "galón" → "galones", "lápiz" → "lápices"
export function pluralize(nombre: string): string {
  const word = nombre.trim().toLowerCase();
  if (/[aeiouáéíóú]$/.test(word)) return `${word}s`;
  if (word.endsWith('z')) return `${word.slice(0, -1)}ces`;
  const plain = word.replace(/[áéíóú]([^áéíóú]*)$/, (m, rest) => m[0].normalize('NFD')[0] + rest);
  return `${plain}es`;
}

// 75 with a 50 lb caja → "1.5 cajas"; 50 → "1 caja"; 0 or rounds to 0 → null
export function inPresentation(value: number | null, presentation?: Presentation): string | null {
  if (value === null || !presentation || presentation.factor <= 0) {
    return null;
  }
  const amount = +(Math.abs(value) / presentation.factor).toFixed(2);
  if (amount === 0) {
    return null;
  }
  const nombre = amount === 1 ? presentation.nombre.trim().toLowerCase() : pluralize(presentation.nombre);
  return `${amount} ${nombre}`;
}

// Call it in a component field initializer: loads the presentations once per page and returns
// a function for the template. It reads a signal, so the view updates when they arrive.
//   readonly pres = injectPresentations();
//   {{ pres(product.id, product.existencia) }}  →  "(2 cajas)" or ''
export function injectPresentations() {
  const biggest = signal(new Map<number, Presentation>());
  inject(DataServices)
    .getPresentations()
    .subscribe({
      next: (list) => {
        const map = new Map<number, Presentation>();
        for (const p of list) {
          const current = map.get(p.producto_id);
          if (!current || p.factor > current.factor) {
            map.set(p.producto_id, p);
          }
        }
        biggest.set(map);
      },
      // Without presentations the page still works, just without the "(…)"
      error: () => {},
    });
  return (productoId: number, value: number | null): string => {
    const text = inPresentation(value, biggest().get(productoId));
    return text ? `(${text})` : '';
  };
}
