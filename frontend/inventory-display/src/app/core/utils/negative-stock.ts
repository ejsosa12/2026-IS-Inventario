import { NegativeStockItem } from '../../models/entry';

const UNIT: Record<string, string> = { unidad: 'u', lb: 'lb', m: 'm', gal: 'gal' };

// HU-14 + HU-18: the stock never goes below 0. Flask answers 409 with the products that would.
// "Clavo 3 pulgadas quedaría en -5 u (hay 95 u)"
export function negativeStockMessage(items: NegativeStockItem[]): string {
  return items
    .map((p) => {
      const unit = UNIT[p.unidad_base] ?? '';
      return `${p.nombre} quedaría en ${+p.quedaria.toFixed(3)} ${unit} (hay ${+p.existencia.toFixed(3)} ${unit})`;
    })
    .join('; ');
}
