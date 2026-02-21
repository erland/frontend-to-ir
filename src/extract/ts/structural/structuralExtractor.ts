import ts from 'typescript';
import path from 'node:path';
import {
  createEmptyIrModel,
  IrClassifier,
  IrModel,
  IrRelation,
  IrRelationKind,
  IrAttribute,
  IrTypeRef,
  IrVisibility,
  IrClassifierKind,
  IrSourceRef,
} from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import { typeToIrTypeRef, typeNodeToIrTypeRef, collectReferencedTypeSymbols } from '../typeRef';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding, incCount } from '../../../report/reportBuilder';

export type StructuralExtractOptions = {
  importGraph?: boolean;
  includeDeps?: boolean;
  report?: ExtractionReport;
};

export type PackageRec = { id: string; name: string; qualifiedName: string | null; parentId: string | null };

export type StructuralExtractResult = {
  model: IrModel;
  pkgByDir: Map<string, PackageRec>;
  ensureFileModule: (relFile: string, pkgId: string) => IrClassifier;
};

type DeclaredSymbol = {
  id: string;
  kind: IrClassifierKind;
};

function visibilityFromModifiers(mods: readonly ts.Modifier[] | undefined): IrVisibility | undefined {
  if (!mods) return undefined;
  if (mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'PRIVATE';
  if (mods.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'PROTECTED';
  if (mods.some((m) => m.kind === ts.SyntaxKind.PublicKeyword)) return 'PUBLIC';
  return undefined;
}

function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pos = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  // IR schema: IrSourceRef only includes file + 1-based line.
  return { file: rel, line: pos.line + 1 };
}

function classifierKindFromNode(node: ts.Node): IrClassifierKind | null {
  if (ts.isClassDeclaration(node)) return 'CLASS';
  if (ts.isInterfaceDeclaration(node)) return 'INTERFACE';
  if (ts.isEnumDeclaration(node)) return 'ENUM';
  if (ts.isTypeAliasDeclaration(node)) return 'TYPE_ALIAS';
  if (ts.isFunctionDeclaration(node)) return 'FUNCTION';
  return null;
}

function buildPackageMap(filesAbs: string[], projectRoot: string) {
  const pkgByDir = new Map<string, PackageRec>();

  const ensurePkg = (dirRel: string) => {
    const dir = dirRel === '.' ? '' : toPosixPath(dirRel);
    if (pkgByDir.has(dir)) return pkgByDir.get(dir)!;

    const parts = dir ? dir.split('/') : [];
    const name = parts.length ? parts[parts.length - 1] : '(root)';
    const qualifiedName = parts.length ? parts.join('.') : null;
    const parentDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const parentId = parts.length ? hashId('pkg:', parentDir === '' ? '(root)' : parentDir) : null;
    const id = hashId('pkg:', dir === '' ? '(root)' : dir);

    const rec = { id, name, qualifiedName, parentId };
    pkgByDir.set(dir, rec);

    if (parts.length > 0) ensurePkg(parentDir);
    return rec;
  };

  for (const abs of filesAbs) {
    const rel = path.relative(projectRoot, abs);
    ensurePkg(path.dirname(rel));
  }
  return pkgByDir;
}

export function extractStructuralModel(ctx: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  scannedAbs: string[];
  checker: ts.TypeChecker;
  options: StructuralExtractOptions;
}): StructuralExtractResult {
  const { program, projectRoot, scannedRel, scannedAbs, checker } = ctx;
  const opts = ctx.options;

  const model = createEmptyIrModel();

  // Packages
  const pkgByDir = buildPackageMap(scannedAbs, projectRoot);
  model.packages = Array.from(pkgByDir.values()).map((p) => ({
    id: p.id,
    name: p.name,
    qualifiedName: p.qualifiedName,
    parentId: p.parentId,
  }));

  // First pass: declare classifiers + symbol map
  const declared = new Map<ts.Symbol, DeclaredSymbol>();
  const classifierById = new Map<string, IrClassifier>();

  // Optional module classifier per file, used for import graph extraction.
  const moduleByRelFile = new Map<string, IrClassifier>();

  const ensureFileModule = (relFile: string, pkgId: string) => {
    let mod = moduleByRelFile.get(relFile);
    if (mod) return mod;
    const name = path.posix.basename(relFile);
    const id = hashId('m:', relFile);
    mod = {
      id,
      name,
      qualifiedName: relFile,
      packageId: pkgId,
      kind: 'MODULE',
      attributes: [],
      operations: [],
      stereotypes: [{ name: 'SourceFile' }],
      taggedValues: [{ key: 'source.file', value: relFile }],
      source: { file: relFile, line: 1 },
    };
    moduleByRelFile.set(relFile, mod);
    classifierById.set(id, mod);
    return mod;
  };

  const declareInSourceFile = (sf: ts.SourceFile) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
    const prefix = pkg.qualifiedName ? `${pkg.qualifiedName}` : null;

    if (opts.importGraph) {
      ensureFileModule(relFile, pkg.id);
    }

    const addClassifier = (node: ts.Node, name: string, kind: IrClassifierKind, sym: ts.Symbol) => {
      const qn = prefix ? `${prefix}.${name}` : name;
      const id = hashId('c:', `${kind}:${relFile}:${qn}`);
      const cls: IrClassifier = {
        id,
        name,
        qualifiedName: qn,
        packageId: pkg.id,
        kind,
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
        source: sourceRefForNode(sf, node, projectRoot),
      };
      classifierById.set(id, cls);
      declared.set(sym, { id, kind });
      if (opts.report) incCount(opts.report.counts.classifiersByKind, kind);
      return cls;
    };

    const visit = (node: ts.Node) => {
      const kind = classifierKindFromNode(node);
      if (kind) {
        if (
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isFunctionDeclaration(node)
        ) {
          const n = node.name;
          if (n && ts.isIdentifier(n)) {
            const sym = checker.getSymbolAtLocation(n);
            if (sym) addClassifier(node, n.text, kind, sym);
          }
        }
      }

      // Step 5/React: function components in TS extraction require top-level const/let function-like
      if (ts.isVariableStatement(node)) {
        const isTopLevel = node.parent && ts.isSourceFile(node.parent);
        if (!isTopLevel) {
          ts.forEachChild(node, visit);
          return;
        }
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const name = decl.name.text;
          const init = decl.initializer;
          if (!init) continue;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            const sym = checker.getSymbolAtLocation(decl.name);
            if (sym) addClassifier(decl, name, 'FUNCTION', sym);
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
    declareInSourceFile(sf);
  }

  // Second pass: fill classifiers members + relations
  const relations: IrRelation[] = [];

  const addRelation = (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags?: { key: string; value: string }[],
  ) => {
    if (kind === 'DEPENDENCY' && !opts.includeDeps) return;

    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const key = `${kind}:${relFile}:${fromId}->${toId}:${(tags ?? []).map((t) => `${t.key}=${t.value}`).join(',')}:${node.pos}`;
    const id = hashId('r:', key);

    const r: IrRelation = {
      id,
      kind,
      sourceId: fromId,
      targetId: toId,
      taggedValues: tags,
      source: sourceRefForNode(sf, node, projectRoot),
    };
    relations.push(r);
    if (opts.report) incCount(opts.report.counts.relationsByKind, kind);
  };

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
    const prefix = pkg.qualifiedName ? `${pkg.qualifiedName}` : null;

    const visit = (node: ts.Node) => {
      // Handle declared classifiers
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
          // heritage: extends/implements
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

          // members
          for (const m of node.members) {
            if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
              if (!m.name) continue;
              const name = ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf);
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

              // association edge
              const target = resolveDeclaredId(type);
              if (target) addRelation(sf, 'ASSOCIATION', cls.id, target, m, [{ key: 'member', value: name }]);

              // dependency edges from referenced type symbols
              if (opts.includeDeps) {
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
                      : m.name.getText(sf)
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

              if (opts.includeDeps && sig) {
                // dependency edges from return + param types
                // simpler: just collect referenced from return + param declared types
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
          // enum members as attributes
          for (const mem of node.members) {
            const n = mem.name.getText(sf);
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
          cls.taggedValues.push({ key: 'ts.typeAlias', value: node.type.getText(sf) });
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

      // Handle variable-statement functions (top-level const arrow) declared in first pass
      if (ts.isVariableStatement(node) && node.parent && ts.isSourceFile(node.parent)) {
        for (const declNode of node.declarationList.declarations) {
          if (!ts.isIdentifier(declNode.name)) continue;
          const sym = checker.getSymbolAtLocation(declNode.name);
          const decl = sym ? declared.get(sym) : undefined;
          if (!decl) continue;
          const cls = classifierById.get(decl.id)!;
          const init = declNode.initializer;
          if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;

          // treat as an operation signature on the classifier itself
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

  model.classifiers = Array.from(classifierById.values());
  model.relations = relations;

  return { model, pkgByDir, ensureFileModule };
}
