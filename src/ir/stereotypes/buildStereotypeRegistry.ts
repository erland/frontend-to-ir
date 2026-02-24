import type {
  IrAttribute,
  IrClassifier,
  IrModel,
  IrOperation,
  IrRelation,
  IrStereotype,
  IrStereotypeDefinition,
  IrStereotypeRef,
} from '../irV1';
import { stableStereotypeId } from './stereotypeId';

type OwnerKind = 'classifier' | 'attribute' | 'operation' | 'relation';

type Owner = { kind: OwnerKind; framework: string | null; stereotypes?: IrStereotype[] };

function getFramework(taggedValues?: { key: string; value: string }[]): string | null {
  const tv = (taggedValues ?? []).find((t) => t.key === 'framework');
  return tv?.value ?? null;
}


function appliesToForOwnerKind(kind: OwnerKind): string[] {
  switch (kind) {
    case 'classifier':
      return ['Class'];
    case 'attribute':
      return ['Property'];
    case 'operation':
      return ['Operation'];
    case 'relation':
      return ['Dependency'];
    default:
      return ['NamedElement'];
  }
}

/**
 * Builds IR v2 stereotype registry + refs from currently emitted legacy stereotypes.
 *
 * - Reads existing `element.stereotypes` arrays (legacy).
 * - Populates `model.stereotypeDefinitions` with a stable set of definitions.
 * - Populates `element.stereotypeRefs` with id references.
 *
 * Legacy stereotypes are kept intact (compatibility) while v2 fields are added in parallel.
 */
export function buildStereotypeRegistryFromLegacy(model: IrModel): IrModel {
  const defsById = new Map<string, IrStereotypeDefinition>();

  const addDefs = (owner: Owner, kind: OwnerKind) => {
    for (const s of owner.stereotypes ?? []) {
      const id = stableStereotypeId(owner.framework, s);
      if (!defsById.has(id)) {
        defsById.set(id, {
          id,
          name: s.name,
          qualifiedName: s.qualifiedName ?? null,
          profileName: owner.framework ? owner.framework : 'Generic',
          appliesTo: appliesToForOwnerKind(kind),
          properties: [],
        });
      }
    }
  };

  const mkRefs = (owner: Owner): IrStereotypeRef[] => {
    const refs: IrStereotypeRef[] = [];
    for (const s of owner.stereotypes ?? []) {
      refs.push({ stereotypeId: stableStereotypeId(owner.framework, s), values: {} });
    }
    refs.sort((a, b) => a.stereotypeId.localeCompare(b.stereotypeId));
    return refs;
  };

  const classifiers: IrClassifier[] = (model.classifiers ?? []).map((c) => {
    const fw = getFramework(c.taggedValues);
    addDefs({ kind: 'classifier', framework: fw, stereotypes: c.stereotypes }, 'classifier');

    const attributes: IrAttribute[] = (c.attributes ?? []).map((a) => {
      addDefs({ kind: 'attribute', framework: fw, stereotypes: a.stereotypes }, 'attribute');
      const stereotypeRefs = mkRefs({ kind: 'attribute', framework: fw, stereotypes: a.stereotypes });
      return { ...a, stereotypeRefs: stereotypeRefs.length ? stereotypeRefs : a.stereotypeRefs };
    });

    const operations: IrOperation[] = (c.operations ?? []).map((o) => {
      addDefs({ kind: 'operation', framework: fw, stereotypes: o.stereotypes }, 'operation');
      const stereotypeRefs = mkRefs({ kind: 'operation', framework: fw, stereotypes: o.stereotypes });
      return { ...o, stereotypeRefs: stereotypeRefs.length ? stereotypeRefs : o.stereotypeRefs };
    });

    const stereotypeRefs = mkRefs({ kind: 'classifier', framework: fw, stereotypes: c.stereotypes });

    return {
      ...c,
      attributes,
      operations,
      stereotypeRefs: stereotypeRefs.length ? stereotypeRefs : c.stereotypeRefs,
    };
  });

  const relations: IrRelation[] = (model.relations ?? []).map((r) => {
    const fw = getFramework(r.taggedValues);
    addDefs({ kind: 'relation', framework: fw, stereotypes: r.stereotypes }, 'relation');
    const stereotypeRefs = mkRefs({ kind: 'relation', framework: fw, stereotypes: r.stereotypes });
    return { ...r, stereotypeRefs: stereotypeRefs.length ? stereotypeRefs : r.stereotypeRefs };
  });

  const stereotypeDefinitions = Array.from(defsById.values()).sort((a, b) => a.id.localeCompare(b.id));

  return {
    ...model,
    stereotypeDefinitions: stereotypeDefinitions.length ? stereotypeDefinitions : model.stereotypeDefinitions ?? [],
    classifiers,
    relations,
  };
}
