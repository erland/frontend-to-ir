import type { IrClassifier } from '../../../../ir/irV1';
import { ensureFramework, setTaggedValue } from '../../../../ir/taggedValues';

export function hasStereotype(c: IrClassifier, name: string): boolean {
  return (c.stereotypes ?? []).some((st) => st.name === name);
}

export function addStereotype(c: IrClassifier, name: string): void {
  c.stereotypes = c.stereotypes ?? [];
  if (!hasStereotype(c, name)) c.stereotypes.push({ name });
}

export function setClassifierTag(c: IrClassifier, key: string, value: string): void {
  setTaggedValue(c, key, value);
}

export function setFramework(c: IrClassifier, framework: string): void {
  ensureFramework(c, framework);
}
