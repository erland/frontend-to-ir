import ts from 'typescript';
import path from 'node:path';
import { safeNodeText } from '../../util/safeText';
import type { IrClassifier, IrRelation, IrRelationKind, IrTypeRef } from '../../../../ir/irV1';
import { hashId, toPosixPath } from '../../../../util/id';
import { typeToIrTypeRef, typeNodeToIrTypeRefResolved, ResolveQualifiedNameFn } from '../../typeRef';
import type { IrPackageInfo } from '../../context';
import { sourceRefForNode } from '../util';
import type { DeclaredSymbol } from '../declareClassifiers';
import { extractFieldMember } from './extractFields';
import { extractMethodMember } from './extractMethods';
import { extractAccessorMember } from './extractAccessors';

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

  const resolveQualifiedName: ResolveQualifiedNameFn = (sym) => {
    let s = sym;
    // Normalize aliases (imports/re-exports) to the underlying symbol.
    // eslint-disable-next-line no-bitwise
    if (s.flags & ts.SymbolFlags.Alias) {
      try {
        s = checker.getAliasedSymbol(s);
      } catch {
        // ignore
      }
    }
    const d = declared.get(s);
    if (!d) return undefined;
    const cls = classifierById.get(d.id);
    return cls?.qualifiedName ?? cls?.name;
  };

  const toIrType = (t: ts.Type, typeAnn?: ts.TypeNode): IrTypeRef => {
    if (typeAnn) return typeNodeToIrTypeRefResolved(typeAnn, checker, resolveQualifiedName);
    return typeToIrTypeRef(t, checker, undefined, resolveQualifiedName);
  };

  const fillInSourceFile = (sf: ts.SourceFile) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    // kept for parity (prefix may be used later)
    void (pkgByDir.get(pkgKey) ?? pkgByDir.get('')!);

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
              extractFieldMember({
                sf,
                member: m,
                cls,
                checker,
                projectRoot,
                toIrType,
                resolveDeclaredId,
                declared: declared as any,
                includeDeps,
                addRelation,
              });
              continue;
            }

            if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m) || ts.isConstructorDeclaration(m)) {
              extractMethodMember({
                sf,
                member: m as any,
                cls,
                checker,
                projectRoot,
                toIrType,
                includeDeps,
                declared: declared as any,
                addRelation,
              });
              continue;
            }

            if (ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
              extractAccessorMember({ sf, member: m, cls });
              continue;
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
              returnType: node.type ? toIrType(checker.getTypeFromTypeNode(node.type), node.type) : toIrType(checker.getReturnTypeOfSignature(sig)),
              parameters: node.parameters.map((p) => {
                const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
                const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
                return { name: pn, type: toIrType(pt, p.type ?? undefined) };
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
              returnType: init.type ? toIrType(checker.getTypeFromTypeNode(init.type), init.type) : toIrType(checker.getReturnTypeOfSignature(sig)),
              parameters: init.parameters.map((p) => {
                const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
                const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
                return { name: pn, type: toIrType(pt, p.type ?? undefined) };
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
