import ts from 'typescript';
import path from 'node:path';

import type { IrClassifier, IrRelationKind, IrSourceRef, IrTaggedValue } from '../../../../ir/irV1';
import { hashId, toPosixPath } from '../../../../util/id';
import type { IrPackageInfo } from '../../context';

export function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

export function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pos = node.getStart(sf, false);
  const lc = ts.getLineAndCharacterOfPosition(sf, pos);
  return { file: rel, line: lc.line + 1, col: lc.character + 1 };
}

export function ensurePkgIdForRel(relFile: string, pkgByDir: Map<string, IrPackageInfo>): string {
  const pkgDir = toPosixPath(path.dirname(relFile));
  const pkgKey = pkgDir === '.' ? '' : pkgDir;
  const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
  return pkg.id;
}

export function ensureApiExportClassifier(args: {
  model: { classifiers: IrClassifier[] };
  projectRoot: string;
  relFile: string;
  exportName: string;
  node: ts.Node;
  sf: ts.SourceFile;
  pkgId: string;
}): IrClassifier {
  const { model, projectRoot, relFile, exportName, node, sf, pkgId } = args;
  const key = `publicApi:export:${relFile}:${exportName}`;
  const id = hashId('c:', key);
  const existing = model.classifiers.find((c) => c.id === id);
  if (existing) return existing;

  const c: IrClassifier = {
    id,
    kind: 'MODULE',
    name: exportName,
    qualifiedName: key,
    packageId: pkgId,
    stereotypes: [{ name: 'ApiExport' }],
    taggedValues: [tag('origin', 'publicApi'), tag('exportedFrom', relFile)],
    source: sourceRefForNode(sf, node, projectRoot),
  };
  model.classifiers.push(c);
  return c;
}

export function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

export function unwrapAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  if ((sym.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(sym);
    } catch {
      return sym;
    }
  }
  return sym;
}

export function resolveSymbolDeclSourceFile(checker: ts.TypeChecker, sym: ts.Symbol): ts.SourceFile | null {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return null;
  return decl.getSourceFile();
}

export function makePublicApiRelId(args: {
  projectRoot: string;
  sf: ts.SourceFile;
  kind: IrRelationKind;
  fromId: string;
  toId: string;
  tags: IrTaggedValue[];
}): { relFile: string; id: string } {
  const { projectRoot, sf, kind, fromId, toId, tags } = args;
  const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
  const id = hashId('r:', `PUBLICAPI:${kind}:${relFile}:${fromId}->${toId}:${tags.map((t) => `${t.key}=${t.value}`).join(';')}`);
  return { relFile, id };
}
