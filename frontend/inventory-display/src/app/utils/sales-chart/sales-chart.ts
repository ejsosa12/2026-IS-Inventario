import { Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SalesDay } from '../../models/report';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// HU-24: money sold per day as bars. Plain HTML/CSS (no chart library). Used by the
// dashboard (last days) and by the "Más vendidos" tab of Análisis.
@Component({
  imports: [DecimalPipe],
  selector: 'app-sales-chart',
  templateUrl: './sales-chart.html',
})
export class SalesChart {
  // Every day of the range, oldest first (Flask fills the days without sales with 0)
  readonly days = input.required<SalesDay[]>();

  // The bar under the cursor (or focused with the keyboard)
  hovered = signal<SalesDay | null>(null);

  readonly empty = computed(() => this.days().every((d) => d.total === 0));

  // Top of the scale rounded up to 1, 2 or 5 × 10^n so the labels are round numbers
  readonly scaleMax = computed(() => {
    const max = Math.max(0, ...this.days().map((d) => d.total));
    if (max === 0) {
      return 100;
    }
    const power = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 5, 10].find((n) => n * power >= max)!;
    return step * power;
  });

  // Show a date under at most ~10 bars so they do not overlap
  readonly labelEvery = computed(() => Math.max(1, Math.ceil(this.days().length / 10)));

  readonly totals = computed(() => ({
    ventas: this.days().reduce((sum, d) => sum + d.ventas, 0),
    total: this.days().reduce((sum, d) => sum + d.total, 0),
  }));

  height(day: SalesDay): number {
    return (day.total / this.scaleMax()) * 100;
  }

  // "19/11" by hand (new Date('2026-11-19') would be UTC and could show the 18th)
  short(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  // "Jue 19/11"
  long(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${this.short(iso)}`;
  }

  // Q1,500 / Q1.5k on the axis
  axis(value: number): string {
    return value >= 10000 ? `Q${+(value / 1000).toFixed(1)}k` : `Q${value.toLocaleString('es-GT')}`;
  }
}
