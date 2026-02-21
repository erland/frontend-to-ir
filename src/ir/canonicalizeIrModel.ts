import type {
  IrAttribute,
  IrClassifier,
  IrModel,
  IrOperation,
  IrPackage,
  IrRelation,
  IrStereotype,
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
    taggedValues: canonicalizeTaggedValues(p.taggedValues),
  };
}

function canonicalizeClassifier(c: IrClassifier): IrClassifier {
  return {
    ...c,
    attributes: sortByNullableIdOrName(c.attributes ?? [], (a) => a.name).map(canonicalizeAttribute),
    operations: sortByNullableIdOrName(c.operations ?? [], (o) => o.name).map(canonicalizeOperation),
    stereotypes: canonicalizeStereotypes(c.stereotypes),
    taggedValues: canonicalizeTaggedValues(c.taggedValues),
  };
}

function canonicalizeAttribute(a: IrAttribute): IrAttribute {
  return {
    ...a,
    stereotypes: canonicalizeStereotypes(a.stereotypes),
    taggedValues: canonicalizeTaggedValues(a.taggedValues),
  };
}

function canonicalizeOperation(o: IrOperation): IrOperation {
  return {
    ...o,
    parameters: (o.parameters ?? []).slice().sort((x, y) => x.name.localeCompare(y.name)),
    stereotypes: canonicalizeStereotypes(o.stereotypes),
    taggedValues: canonicalizeTaggedValues(o.taggedValues),
  };
}

function canonicalizeRelation(r: IrRelation): IrRelation {
  return {
    ...r,
    stereotypes: canonicalizeStereotypes(r.stereotypes),
    taggedValues: canonicalizeTaggedValues(r.taggedValues),
  };
}

function canonicalizeStereotypes(arr?: IrStereotype[]): IrStereotype[] {
  return (arr ?? [])
    .slice()
    .sort((a, b) =>
      a.name === b.name
        ? String(a.qualifiedName ?? '').localeCompare(String(b.qualifiedName ?? ''))
        : a.name.localeCompare(b.name),
    )
    .map((s) => ({ name: s.name, qualifiedName: s.qualifiedName ?? null }));
}

function canonicalizeTaggedValues(arr?: IrTaggedValue[]): IrTaggedValue[] {
  return (arr ?? [])
    .slice()
    .sort((a, b) => (a.key === b.key ? a.value.localeCompare(b.value) : a.key.localeCompare(b.key)));
}

function sortById<T extends { id: string }>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function sortByNullableIdOrName<T extends { id?: string | null }>(
  arr: T[],
  nameFn: (t: T) => string,
): T[] {
  return arr.slice().sort((a, b) => {
    const ak = a.id ?? nameFn(a);
    const bk = b.id ?? nameFn(b);
    return ak.localeCompare(bk);
  });
}
