import type { IrClassifier, IrModel, IrTypeRef } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding, incCount } from '../../../report/reportBuilder';

/**
 * Post-processing for reports.
 *
 * Kept out of tsExtractor.ts so orchestration can stay thin during refactors.
 * Behavior should remain stable: counts are incremented and unresolved type findings are added.
 */
export function postProcessReportFromModel(model: IrModel, report: ExtractionReport) {
  for (const c of model.classifiers) incCount(report.counts.classifiersByKind, c.kind);
  for (const r of model.relations ?? []) incCount(report.counts.relationsByKind, r.kind);

  const classifierByName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) classifierByName.set(c.name, c);

  const isBuiltin = (name: string) =>
    [
      'string',
      'number',
      'boolean',
      'bigint',
      'void',
      'never',
      'any',
      'unknown',
      'Array',
      'ReadonlyArray',
      'Promise',
      'Record',
      'Map',
      'Set',
      'Date',
      'RegExp',
      'Error',
      'Function',
      'Object',
      'String',
      'Number',
      'Boolean',
    ].includes(name);

  const collectNamed = (tr: IrTypeRef | null | undefined, out: Set<string>) => {
    if (!tr) return;
    if (tr.kind === 'NAMED') {
      if (tr.name) out.add(tr.name);
      return;
    }
    if (tr.kind === 'GENERIC') {
      if (tr.name) out.add(tr.name);
      (tr.typeArgs ?? []).forEach((a) => collectNamed(a, out));
      return;
    }
    if (tr.kind === 'ARRAY') {
      collectNamed(tr.elementType, out);
      return;
    }
    if (tr.kind === 'UNION' || tr.kind === 'INTERSECTION') {
      (tr.typeArgs ?? []).forEach((a) => collectNamed(a, out));
    }
  };

  for (const c of model.classifiers) {
    const locFile = c.source?.file;
    const line = c.source?.line ?? undefined;
    const baseLoc = locFile ? { file: locFile, line: line === null ? undefined : line } : undefined;

    for (const a of c.attributes ?? []) {
      const names = new Set<string>();
      collectNamed(a.type, names);
      for (const nm of names) {
        if (isBuiltin(nm)) continue;
        if (!classifierByName.has(nm)) {
          addFinding(report, {
            kind: 'unresolvedType',
            severity: 'warning',
            message: `Unresolved attribute type '${nm}' on ${c.name}.${a.name}`,
            location: baseLoc,
            tags: { owner: c.name, member: a.name, role: 'attribute', type: nm },
          });
        }
      }
    }

    for (const op of c.operations ?? []) {
      const names = new Set<string>();
      collectNamed(op.returnType, names);
      for (const p of op.parameters ?? []) collectNamed(p.type, names);
      for (const nm of names) {
        if (isBuiltin(nm)) continue;
        if (!classifierByName.has(nm)) {
          addFinding(report, {
            kind: 'unresolvedType',
            severity: 'warning',
            message: `Unresolved operation type '${nm}' on ${c.name}.${op.name}()`,
            location: baseLoc,
            tags: { owner: c.name, member: op.name, role: 'operation', type: nm },
          });
        }
      }
    }
  }
}
