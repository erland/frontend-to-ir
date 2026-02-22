import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import path from 'node:path';
import type { IrAttribute, IrClassifier, IrModel, IrRelation, IrRelationKind, IrTypeRef } from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import { typeToIrTypeRef, typeNodeToIrTypeRef, collectReferencedTypeSymbols } from '../typeRef';
import type { IrPackageInfo } from '../context';
import { classifierKindFromNode, sourceRefForNode, visibilityFromModifiers } from './util';
import type { DeclaredSymbol } from './declareClassifiers';

export function fillMembersAndRelations(ctx: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  pkgByDir: Map<string, IrPackageInfo>;
  checker: ts.TypeChecker;
  declared: Map<ts.Symbol, DeclaredSymbol>;
  classifierById: Map<string, IrClassifier>;
  relations: IrRelation[];
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
  const { program, projectRoot, scannedRel, pkgByDir, checker, declared, classifierById, includeDeps, addRelation } = ctx;

  const resolveDeclaredId = (t: ts.Type) => {
    const sym = t.getSymbol();
    if (!sym) return null;
    const found = declared.get(sym);
    return found?.id ?? null;
  };

  const fillInSourceFile = (sf: ts.SourceFile) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
    void pkg; // kept for parity (prefix may be used later)
    const visit = (node: ts.Node) => {
      if (
        (ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        const sym = checker.getSymbolAtLocation(node.name);
        const decl = sym ? declared.get(sym) : undefined;
        if (!decl) {
          ts.forEachChild(node, visit);
          return;
        }
        const cls = classifierById.get(decl.id)!;

        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
          const heritage = node.heritageClauses ?? [];
          for (const hc of heritage) {
            const isExt = hc.token === ts.SyntaxKind.ExtendsKeyword;
            const isImpl = hc.token === ts.SyntaxKind.ImplementsKeyword;
            for (const t of hc.types) {
              const type = checker.getTypeAtLocation(t.expression);
              const toId = resolveDeclaredId(type);
              if (!toId) continue;
              if (isExt) addRelation(sf, 'GENERALIZATION', cls.id, toId, t);
              if (isImpl) addRelation(sf, 'REALIZATION', cls.id, toId, t);
            }
          }

          for (const m of node.members) {
            if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
              if (!m.name) continue;
              const name = ts.isIdentifier(m.name) ? m.name.text : safeNodeText(m.name, sf);
              const symM = checker.getSymbolAtLocation(m.name as any);
              const typeAnn = (m as any).type as ts.TypeNode | undefined;
              const type = typeAnn ? checker.getTypeFromTypeNode(typeAnn) : symM ? checker.getTypeOfSymbolAtLocation(symM, m) : checker.getTypeAtLocation(m);
              const typeRef = typeAnn ? typeNodeToIrTypeRef(typeAnn, checker) : typeToIrTypeRef(type, checker);
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

            if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m) || ts.isConstructorDeclaration(m)) {
              const isCtor = ts.isConstructorDeclaration(m);
              const name =
                isCtor
                  ? 'constructor'
                  : m.name
                    ? ts.isIdentifier(m.name)
                      ? m.name.text
                      : safeNodeText(m.name, sf)
                    : 'method';
              const sig = checker.getSignatureFromDeclaration(m as any);
              const returnType: IrTypeRef =
                isCtor
                  ? { kind: 'NAMED', name: cls.name }
                  : m.type
                    ? typeNodeToIrTypeRef(m.type, checker)
                    : sig
                      ? typeToIrTypeRef(checker.getReturnTypeOfSignature(sig), checker)
                      : { kind: 'UNKNOWN', name: 'unknown' };

              const params = (m as any).parameters?.map((p: ts.ParameterDeclaration) => {
                const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
                const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
                return {
                  name: pn,
                  type: p.type ? typeNodeToIrTypeRef(p.type, checker) : typeToIrTypeRef(pt, checker),
                };
              }) ?? [];

              cls.operations = cls.operations ?? [];
              cls.operations.push({
                id: hashId('o:', `${cls.id}:${name}`),
                name,
                returnType,
                parameters: params,
                visibility: visibilityFromModifiers((m as any).modifiers),
                source: sourceRefForNode(sf, m, projectRoot),
              });

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
          }
        }

        if (ts.isEnumDeclaration(node)) {
          for (const mem of node.members) {
            const n = safeNodeText(mem.name, sf);
            cls.attributes = cls.attributes ?? [];
            cls.attributes.push({
              id: hashId('a:', `${cls.id}:${n}`),
              name: n,
              type: { kind: 'PRIMITIVE', name: 'number' },
              source: sourceRefForNode(sf, mem, projectRoot),
            });
          }
        }

        if (ts.isTypeAliasDeclaration(node)) {
          cls.taggedValues = cls.taggedValues ?? [];
          cls.taggedValues.push({ key: 'ts.typeAlias', value: safeNodeText(node.type, sf) });
        }

        if (ts.isFunctionDeclaration(node)) {
          const sig = node.name ? checker.getSignatureFromDeclaration(node) : undefined;
          if (sig) {
            cls.operations = cls.operations ?? [];
            cls.operations.push({
              id: hashId('o:', `${cls.id}:${cls.name}`),
              name: cls.name,
              returnType: node.type ? typeNodeToIrTypeRef(node.type, checker) : typeToIrTypeRef(checker.getReturnTypeOfSignature(sig), checker),
              parameters: node.parameters.map((p) => {
                const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
                const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
                return { name: pn, type: p.type ? typeNodeToIrTypeRef(p.type, checker) : typeToIrTypeRef(pt, checker) };
              }),
              source: sourceRefForNode(sf, node, projectRoot),
            });
          }
        }
      }

      if (ts.isVariableStatement(node) && node.parent && ts.isSourceFile(node.parent)) {
        for (const declNode of node.declarationList.declarations) {
          if (!ts.isIdentifier(declNode.name)) continue;
          const sym = checker.getSymbolAtLocation(declNode.name);
          const decl = sym ? declared.get(sym) : undefined;
          if (!decl) continue;
          const cls = classifierById.get(decl.id)!;
          const init = declNode.initializer;
          if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;

          const sig = checker.getSignatureFromDeclaration(init);
          const name = cls.name;
          if (sig) {
            cls.operations = cls.operations ?? [];
            cls.operations.push({
              id: hashId('o:', `${cls.id}:${name}`),
              name,
              returnType: init.type ? typeNodeToIrTypeRef(init.type, checker) : typeToIrTypeRef(checker.getReturnTypeOfSignature(sig), checker),
              parameters: init.parameters.map((p) => {
                const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
                const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
                return { name: pn, type: p.type ? typeNodeToIrTypeRef(p.type, checker) : typeToIrTypeRef(pt, checker) };
              }),
              source: sourceRefForNode(sf, declNode, projectRoot),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;
    fillInSourceFile(sf);
  }
}
