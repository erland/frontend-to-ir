import ts from 'typescript';
import type { IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

export function extractConstructorDiEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, rel, node, c, checker, classifierByName, addRelation, report } = args;

  const getTypeNameFromParam = (p: ts.ParameterDeclaration): string | undefined => {
    const t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
    const sym = t.getSymbol() ?? (t as any).aliasSymbol;
    const n = sym?.getName();
    return n && n !== '__type' ? n : undefined;
  };

  const ctor = node.members.find((m) => ts.isConstructorDeclaration(m)) as ts.ConstructorDeclaration | undefined;
  if (!ctor) return;

  for (const p of ctor.parameters) {
    const tn = getTypeNameFromParam(p);
    if (!tn) continue;
    const to = classifierByName.get(tn);
    if (to) addRelation(sf, 'DI', c.id, to.id, p, [{ key: 'origin', value: 'constructor' }]);
    else if (report) {
      addFinding(report, {
        kind: 'unresolvedType',
        severity: 'warning',
        message: `Constructor DI parameter type '${tn}' on ${c.name} was not found as a classifier`,
        location: { file: rel },
        tags: { owner: c.name, type: tn, origin: 'constructor' },
      });
    }
  }
}
