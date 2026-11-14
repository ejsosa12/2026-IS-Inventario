// Click a column title to sort a list by it (Productos and Productos a agotarse).
// First click sorts ascending, second click descending, third click goes back to
// the order Flask sent.

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

// asc -> desc -> no sort
export function nextSort<K extends string>(
  current: SortState<K> | null,
  key: K,
): SortState<K> | null {
  if (current?.key !== key) {
    return { key, dir: 'asc' };
  }
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

// Font Awesome icon for a column title: both arrows when it is not the sorted column
export function sortIcon<K extends string>(current: SortState<K> | null, key: K): string {
  if (current?.key !== key) {
    return 'fas fa-sort text-gray-300';
  }
  return current.dir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
}

// For aria-sort on the <th>
export function ariaSort<K extends string>(
  current: SortState<K> | null,
  key: K,
): 'ascending' | 'descending' | 'none' {
  if (current?.key !== key) {
    return 'none';
  }
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

// Sorts a copy of the list. Empty values (null, e.g. no mínimo) always go last.
// Text is compared in Spanish ignoring case and accents ("Plomería" next to "plomeria")
export function sortList<T, K extends string>(
  list: T[],
  sort: SortState<K> | null,
  value: (item: T, key: K) => string | number | null,
): T[] {
  if (!sort) {
    return list;
  }
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    if (x === null || y === null) {
      return x === y ? 0 : x === null ? 1 : -1;
    }
    const result =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'es', { sensitivity: 'base', numeric: true });
    return result * factor;
  });
}
