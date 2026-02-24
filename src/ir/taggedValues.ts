import type { IrTaggedValue } from './irV1';

export type HasTaggedValues = { taggedValues?: IrTaggedValue[] };

/**
 * Set (upsert) a tagged value deterministically.
 * - If key exists, its value is replaced.
 * - If it doesn't exist, a new entry is appended.
 */
export function setTaggedValue(obj: HasTaggedValues, key: string, value: string): void {
  obj.taggedValues = obj.taggedValues ?? [];
  const existing = obj.taggedValues.find((tv) => tv.key === key);
  if (existing) existing.value = value;
  else obj.taggedValues.push({ key, value });
}

/** Ensure framework tagged value is present and lowercased. */
export function ensureFramework(obj: HasTaggedValues, framework: string): void {
  setTaggedValue(obj, 'framework', framework.toLowerCase());
}
