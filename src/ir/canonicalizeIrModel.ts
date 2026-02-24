import type {
  IrAttribute,
  IrClassifier,
  IrModel,
  IrOperation,
  IrPackage,
  IrRelation,
  IrStereotype,
  IrStereotypeDefinition,
  IrStereotypeRef,
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
    stereotypeDefinitions: canonicalizeStereotypeDefinitions(model.stereotypeDefinitions ?? []),
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
    stereotypeRefs: canonicalizeStereotypeRefs(c.stereotypeRefs),
    taggedValues: canonicalizeTaggedValues(c.taggedValues),
  };
}

function canonicalizeAttribute(a: IrAttribute): IrAttribute {
  return {
    ...a,
    stereotypes: canonicalizeStereotypes(a.stereotypes),
    stereotypeRefs: canonicalizeStereotypeRefs(a.stereotypeRefs),
    taggedValues: canonicalizeTaggedValues(a.taggedValues),
  };
}

function canonicalizeOperation(o: IrOperation): IrOperation {
  return {
    ...o,
    parameters: (o.parameters ?? []).slice().sort((x, y) => x.name.localeCompare(y.name)),
    stereotypes: canonicalizeStereotypes(o.stereotypes),
    stereotypeRefs: canonicalizeStereotypeRefs(o.stereotypeRefs),
    taggedValues: canonicalizeTaggedValues(o.taggedValues),
  };
}

function canonicalizeRelation(r: IrRelation): IrRelation {
  return {
    ...r,
    stereotypes: canonicalizeStereotypes(r.stereotypes),
    stereotypeRefs: canonicalizeStereotypeRefs(r.stereotypeRefs),
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


function canonicalizeStereotypeRefs(arr?: IrStereotypeRef[]): IrStereotypeRef[] {
  return (arr ?? [])
    .slice()
    .sort((a, b) => a.stereotypeId.localeCompare(b.stereotypeId))
    .map((r) => ({ stereotypeId: r.stereotypeId, values: r.values ?? {} }));
}

function canonicalizeStereotypeDefinitions(arr: IrStereotypeDefinition[]): IrStereotypeDefinition[] {
  return arr
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      qualifiedName: d.qualifiedName ?? null,
      profileName: d.profileName ?? null,
      appliesTo: (d.appliesTo ?? []).slice().sort(),
      properties: (d.properties ?? []).slice().sort((x, y) => x.name.localeCompare(y.name)),
    }));
}
