import type {
  IrAttribute,
  IrClassifier,
  IrModel,
  IrOperation,
  IrPackage,
  IrRelation,
  IrTaggedValue,
} from './irV1';

/**
 * Canonicalize an IR model for deterministic output.
 *
 * We sort arrays that are expected to be order-insensitive:
 * - packages, classifiers, relations
 * - attributes, operations, parameters, stereotypes, taggedValues
 */
export function canonicalizeIrModel(model: IrModel): IrModel {
  return {
    ...model,
    packages: sortById(model.packages ?? []).map(canonicalizePackage),
    classifiers: sortById(model.classifiers ?? []).map(canonicalizeClassifier),
    relations: sortById(model.relations ?? []).map(canonicalizeRelation),
    taggedValues: canonicalizeTaggedValues(model.taggedValues ?? []),
  };
}

function canonicalizePackage(p: IrPackage): IrPackage {
  return {
    ...p,
    stereotypes: canonicalizeStringArray(p.stereotypes),
    taggedValues: canonicalizeTaggedValues(p.taggedValues),
  };
}

function canonicalizeClassifier(c: IrClassifier): IrClassifier {
  return {
    ...c,
    attributes: sortById(c.attributes ?? []).map(canonicalizeAttribute),
    operations: sortById(c.operations ?? []).map(canonicalizeOperation),
    stereotypes: canonicalizeStringArray(c.stereotypes),
    taggedValues: canonicalizeTaggedValues(c.taggedValues),
  };
}

function canonicalizeAttribute(a: IrAttribute): IrAttribute {
  return {
    ...a,
    stereotypes: canonicalizeStringArray(a.stereotypes),
    taggedValues: canonicalizeTaggedValues(a.taggedValues),
  };
}

function canonicalizeOperation(o: IrOperation): IrOperation {
  return {
    ...o,
    parameters: (o.parameters ?? []).slice().sort((x, y) => x.name.localeCompare(y.name)),
    stereotypes: canonicalizeStringArray(o.stereotypes),
    taggedValues: canonicalizeTaggedValues(o.taggedValues),
  };
}

function canonicalizeRelation(r: IrRelation): IrRelation {
  return {
    ...r,
    stereotypes: canonicalizeStringArray(r.stereotypes),
    taggedValues: canonicalizeTaggedValues(r.taggedValues),
  };
}

function canonicalizeStringArray(arr?: string[]): string[] {
  return (arr ?? []).slice().sort((a, b) => a.localeCompare(b));
}

function canonicalizeTaggedValues(arr?: IrTaggedValue[]): IrTaggedValue[] {
  return (arr ?? [])
    .slice()
    .sort((a, b) => (a.key === b.key ? a.value.localeCompare(b.value) : a.key.localeCompare(b.key)));
}

function sortById<T extends { id: string }>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => a.id.localeCompare(b.id));
}
