import ts from 'typescript';
import type { IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { decoratorCallName, getDecoratorArgObject, getDecorators, readArrayIdentifiers } from './util';

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

export function extractNgModuleEdges(args: {
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
  const d = decorators.find((dd: ts.Decorator) => decoratorCallName(dd, sf) === 'NgModule');
  const obj = d ? getDecoratorArgObject(d) : undefined;
  if (!obj) return;

  for (const role of ['imports', 'providers', 'declarations', 'exports', 'bootstrap'] as const) {
    const names = readArrayIdentifiers(obj, role);
    for (const nm of names) {
      const to = classifierByName.get(nm);
      if (to) {
        addRelation(sf, 'DEPENDENCY', c.id, to.id, node, [
          { key: 'origin', value: 'ngmodule' },
          { key: 'role', value: role },
        ]);
      } else if (report) {
        addFinding(report, {
          kind: 'unresolvedDecoratorRef',
          severity: 'warning',
          message: `NgModule ${role} references '${nm}' but it was not found as a classifier`,
          location: { file: relPath },
          tags: { owner: c.name, role, ref: nm },
        });
      }
    }
  }
}
