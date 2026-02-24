import type { IrModel } from '../irV1';

/**
 * Removes legacy v1 `stereotypes` arrays from all elements.
 *
 * The project now treats IR schema v2 (`stereotypeDefinitions` + `stereotypeRefs`) as the only output contract.
 * This function is intentionally applied late in the pipeline (after v2 refs are built).
 */
export function stripLegacyStereotypes(model: IrModel): IrModel {
  return {
    ...model,
    classifiers: (model.classifiers ?? []).map((c) => ({
      ...c,
      stereotypes: [],
      attributes: (c.attributes ?? []).map((a) => ({ ...a, stereotypes: [] })),
      operations: (c.operations ?? []).map((o) => ({ ...o, stereotypes: [] })),
    })),
    relations: (model.relations ?? []).map((r) => ({ ...r, stereotypes: [] })),
  };
}
