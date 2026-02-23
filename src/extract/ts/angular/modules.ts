import ts from 'typescript';
import type { IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { decoratorCallName, getDecoratorArgObject, getDecorators, readArrayIdentifiers, readBooleanProp } from './util';

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

/**
 * Standalone component composition:
 * - @Component({ standalone: true, imports: [...] })
 * Emits DEPENDENCY edges from the component classifier to each imported classifier.
 */
export function extractStandaloneComponentEdges(args: {
  sf: ts.SourceFile;
  node: ts.ClassDeclaration;
  relPath: string;
  c: IrClassifier;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, node, relPath, c, classifierByName, addRelation, report } = args;

  const decorators = getDecorators(node);
  const d = decorators.find((dd: ts.Decorator) => decoratorCallName(dd, sf) === 'Component');
  const obj = d ? getDecoratorArgObject(d) : undefined;
  if (!obj) return;

  const standalone = readBooleanProp(obj, 'standalone');
  if (standalone !== true) return;

  const imports = readArrayIdentifiers(obj, 'imports');
  for (const nm of imports) {
    const to = classifierByName.get(nm);
    if (to) {
      addRelation(sf, 'DEPENDENCY', c.id, to.id, node, [
        { key: 'origin', value: 'standalone' },
        { key: 'role', value: 'imports' },
      ]);
    } else if (report) {
      addFinding(report, {
        kind: 'unresolvedDecoratorRef',
        severity: 'warning',
        message: `Standalone component imports references '${nm}' but it was not found as a classifier`,
        location: { file: relPath },
        tags: { owner: c.name, role: 'imports', ref: nm },
      });
    }
  }
}
