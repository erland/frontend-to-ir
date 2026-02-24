import ts from 'typescript';
import { safeNodeText } from '../../util/safeText';
import type { IrClassifier, IrOperation, IrRelationKind, IrTypeRef } from '../../../../ir/irV1';
import { hashId } from '../../../../util/id';
import { collectReferencedTypeSymbols } from '../../typeRef';
import { sourceRefForNode, visibilityFromModifiers } from '../util';

export function extractMethodMember(ctx: {
  sf: ts.SourceFile;
  member: ts.MethodDeclaration | ts.MethodSignature | ts.ConstructorDeclaration;
  cls: IrClassifier;
  checker: ts.TypeChecker;
  projectRoot: string;
  toIrType: (t: ts.Type, typeAnn?: ts.TypeNode) => IrTypeRef;
  includeDeps?: boolean;
  declared: Map<ts.Symbol, { id: string }>;
  addRelation: (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags?: { key: string; value: string }[],
  ) => void;
}): void {
  const { sf, member: m, cls, checker, projectRoot, toIrType, includeDeps, declared, addRelation } = ctx;

  const isCtor = ts.isConstructorDeclaration(m);
  const name =
    isCtor
      ? 'constructor'
      : (m as any).name
        ? ts.isIdentifier((m as any).name)
          ? ((m as any).name as ts.Identifier).text
          : safeNodeText((m as any).name, sf)
        : 'method';

  const sig = checker.getSignatureFromDeclaration(m as any);

  const returnType: IrTypeRef =
    isCtor
      ? { kind: 'NAMED', name: cls.name }
      : (m as any).type
        ? toIrType(checker.getTypeFromTypeNode((m as any).type), (m as any).type)
        : sig
          ? toIrType(checker.getReturnTypeOfSignature(sig))
          : { kind: 'UNKNOWN', name: 'unknown' };

  const params =
    (m as any).parameters?.map((p: ts.ParameterDeclaration) => {
      const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
      const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
      return {
        name: pn,
        type: toIrType(pt, p.type ?? undefined),
      };
    }) ?? [];

  const op: IrOperation = {
    id: hashId('o:', `${cls.id}:${name}`),
    name,
    returnType,
    parameters: params,
    visibility: visibilityFromModifiers((m as any).modifiers),
    source: sourceRefForNode(sf, m, projectRoot),
  };

  cls.operations = cls.operations ?? [];
  cls.operations.push(op);

  if (includeDeps && sig) {
    const candidates: ts.Type[] = [];
    candidates.push(checker.getReturnTypeOfSignature(sig));
    for (const p of (m as any).parameters ?? []) {
      const t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
      candidates.push(t);
    }
    for (const t of candidates) {
      const refs = new Set<ts.Symbol>();
      collectReferencedTypeSymbols(t, checker, refs);
      for (const rs of refs) {
        const tId = declared.get(rs)?.id;
        if (tId) addRelation(sf, 'DEPENDENCY', cls.id, tId, m, [{ key: 'origin', value: 'signature' }, { key: 'member', value: name }]);
      }
    }
  }
}
