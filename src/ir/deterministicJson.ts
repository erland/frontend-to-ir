/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Deterministic JSON stringify:
 * - Sorts object keys recursively
 * - Preserves array order (arrays should be canonicalized separately)
 *
 * This guarantees stable output for golden tests and version control.
 */
export function stableStringify(value: unknown, space: number = 2): string {
  const normalized = sortKeysDeep(value);
  return JSON.stringify(normalized, null, space) + '\n';
}

function sortKeysDeep(v: any): any {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (typeof v !== 'object') return v;

  const out: Record<string, any> = {};
  for (const k of Object.keys(v).sort()) {
    out[k] = sortKeysDeep(v[k]);
  }
  return out;
}
