import ts from 'typescript';
import type { IrClassifier, IrModel, IrRelation, IrSourceRef, IrTaggedValue } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';

/** Internal working context for React enrichment modules. */
export interface ReactWorkContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  projectRoot: string;
  scannedRel: string[];
  model: IrModel;
  report?: ExtractionReport;
  includeFrameworkEdges?: boolean;

  /** Lookup of classifiers by "<relFile>::<name>" for quick matching. */
  classifierByFileAndName: Map<string, IrClassifier>;

  // Common helpers
  isPascalCase(name: string): boolean;
  sourceRefForNode(sf: ts.SourceFile, node: ts.Node): IrSourceRef;
  hasStereotype(c: IrClassifier, name: string): boolean;
  addStereotype(c: IrClassifier, name: string): void;
  setClassifierTag(c: IrClassifier, key: string, value: string): void;
}

export type TaggedValues = IrTaggedValue[] | undefined;

export function getTaggedValue(tvs: TaggedValues, key: string): string | undefined {
  return (tvs ?? []).find((tv) => tv.key === key)?.value;
}

export function setTaggedValue(tvs: IrTaggedValue[] | undefined, key: string, value: string): IrTaggedValue[] {
  const out = tvs ?? [];
  const existing = out.find((tv) => tv.key === key);
  if (existing) existing.value = value;
  else out.push({ key, value });
  return out;
}
