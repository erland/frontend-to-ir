import ts from 'typescript';
import path from 'node:path';
import type { IrClassifier, IrClassifierKind } from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import type { ExtractionReport } from '../../../report/extractionReport';
import { incCount } from '../../../report/reportBuilder';
import type { EnsureFileModuleFn, IrPackageInfo } from '../context';
import { classifierKindFromNode, sourceRefForNode } from './util';

export type DeclaredSymbol = { id: string; kind: IrClassifierKind };

export function createEnsureFileModule(args: {
  classifierById: Map<string, IrClassifier>;
  moduleByRelFile: Map<string, IrClassifier>;
}): EnsureFileModuleFn {
  const { classifierById, moduleByRelFile } = args;
  return (relFile: string, pkgId: string) => {
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
}

export function declareClassifiersInProgram(ctx: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  pkgByDir: Map<string, IrPackageInfo>;
  checker: ts.TypeChecker;
  importGraph: boolean;
  report?: ExtractionReport;
  declared: Map<ts.Symbol, DeclaredSymbol>;
  classifierById: Map<string, IrClassifier>;
  ensureFileModule: EnsureFileModuleFn;
}): void {
  const { program, projectRoot, scannedRel, pkgByDir, checker, importGraph, report, declared, classifierById, ensureFileModule } = ctx;

  const declareInSourceFile = (sf: ts.SourceFile) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
    const prefix = pkg.qualifiedName ? `${pkg.qualifiedName}` : null;

    if (importGraph) {
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
      if (report) incCount(report.counts.classifiersByKind, kind);
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
}
