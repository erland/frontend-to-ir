import type { IrClassifier } from '../../../../ir/irV1';

export function hasStereotype(c: IrClassifier, name: string): boolean {
  return (c.stereotypes ?? []).some((st) => st.name === name);
}

export function addStereotype(c: IrClassifier, name: string): void {
  c.stereotypes = c.stereotypes ?? [];
  if (!hasStereotype(c, name)) c.stereotypes.push({ name });
}

export function setClassifierTag(c: IrClassifier, key: string, value: string): void {
  c.taggedValues = c.taggedValues ?? [];
  const existing = c.taggedValues.find((tv) => tv.key === key);
  if (existing) existing.value = value;
  else c.taggedValues.push({ key, value });
}
