import ts from 'typescript';
import { safeNodeText } from '../../util/safeText';
import type { IrAttribute, IrClassifier, IrRelationKind, IrTypeRef } from '../../../../ir/irV1';
import { hashId } from '../../../../util/id';
import { collectReferencedTypeSymbols } from '../../typeRef';
import { sourceRefForNode, visibilityFromModifiers } from '../util';

export function extractFieldMember(ctx: {
  sf: ts.SourceFile;
  member: ts.PropertyDeclaration | ts.PropertySignature;
  cls: IrClassifier;
  checker: ts.TypeChecker;
  projectRoot: string;
  toIrType: (t: ts.Type, typeAnn?: ts.TypeNode) => IrTypeRef;
  resolveDeclaredId: (t: ts.Type) => string | null;
  declared: Map<ts.Symbol, { id: string }>;
  includeDeps?: boolean;
  addRelation: (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags?: { key: string; value: string }[],
  ) => void;
}): void {
  const { sf, member: m, cls, checker, projectRoot, toIrType, resolveDeclaredId, declared, includeDeps, addRelation } = ctx;
  if (!m.name) return;

  const name = ts.isIdentifier(m.name) ? m.name.text : safeNodeText(m.name, sf);
  const symM = checker.getSymbolAtLocation(m.name as any);
  const typeAnn = (m as any).type as ts.TypeNode | undefined;
  const type =
    typeAnn
      ? checker.getTypeFromTypeNode(typeAnn)
      : symM
        ? checker.getTypeOfSymbolAtLocation(symM, m)
        : checker.getTypeAtLocation(m);

  const typeRef = toIrType(type, typeAnn);

  const a: IrAttribute = {
    id: hashId('a:', `${cls.id}:${name}`),
    name,
    type: typeRef,
    visibility: visibilityFromModifiers((m as any).modifiers),
    source: sourceRefForNode(sf, m, projectRoot),
  };
  cls.attributes = cls.attributes ?? [];
  cls.attributes.push(a);

  const target = resolveDeclaredId(type);
  if (target) addRelation(sf, 'ASSOCIATION', cls.id, target, m, [{ key: 'member', value: name }]);

  if (includeDeps) {
    const refs = new Set<ts.Symbol>();
    collectReferencedTypeSymbols(type, checker, refs);
    for (const rs of refs) {
      const tId = declared.get(rs)?.id;
      if (tId) addRelation(sf, 'DEPENDENCY', cls.id, tId, m, [{ key: 'origin', value: 'typeRef' }, { key: 'member', value: name }]);
    }
  }
}
