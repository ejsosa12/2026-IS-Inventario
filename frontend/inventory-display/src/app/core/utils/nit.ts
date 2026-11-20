// HU-15: Guatemalan NIT, same rules as normalize_nit() in backend/app/sales/sales.py.
// Digits plus a check digit (0-9 or K, SAT's modulo 11). "CF" = consumidor final.

// "1234567-9" / "CF", or null if it is not valid
export function normalizeNit(raw: string): string | null {
  const text = raw.replace(/[\s-]/g, '').toUpperCase();
  if (text === '' || text === 'CF' || text === 'C/F') return 'CF';
  if (!/^\d{1,12}[\dK]$/.test(text)) return null;
  const body = text.slice(0, -1);
  const check = text.slice(-1);
  // Digits times 2, 3, 4... from the right
  const total = [...body].reverse().reduce((sum, digit, i) => sum + Number(digit) * (i + 2), 0);
  const expected = (11 - (total % 11)) % 11;
  return check === (expected === 10 ? 'K' : String(expected)) ? `${body}-${check}` : null;
}
