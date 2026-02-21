import ts from 'typescript';
import path from 'node:path';
import { IrClassifier, IrRelation, IrRelationKind, IrSourceRef } from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import type { EnsureFileModuleFn, ExtractorContext, IrPackageInfo } from '../context';


function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pos = node.getStart(sf, false);
  const lc = ts.getLineAndCharacterOfPosition(sf, pos);
  return {
    file: rel,
    line: lc.line + 1,
  };
}

export type ImportGraphContext = Omit<ExtractorContext, 'model' | 'checker'> & {
  compilerOptions: ts.CompilerOptions;
  pkgByDir: Map<string, IrPackageInfo>;
  ensureFileModule: EnsureFileModuleFn;
  report?: ExtractionReport;
};

export function extractImportGraphRelations(ctx: ImportGraphContext): IrRelation[] {

  const { program, compilerOptions, projectRoot, scannedRel, pkgByDir, ensureFileModule, report } = ctx;

  const toRelIfInProject = (abs: string) => {
    const rel = toPosixPath(path.relative(projectRoot, abs));
    return scannedRel.includes(rel) ? rel : null;
  };

  const resolveToRel = (specifier: string, fromAbs: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, fromAbs, compilerOptions, ts.sys).resolvedModule;
    if (!resolved?.resolvedFileName) return null;
    const rf = resolved.resolvedFileName;
    if (rf.endsWith('.d.ts')) return null;
    // TypeScript may resolve to a TS file even when importing from JS; that's OK.
    return toRelIfInProject(rf);
  };

  const ensurePkgIdForRel = (relFile: string) => {
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
    return pkg.id;
  };

  const rels: IrRelation[] = [];
  const seen = new Set<string>();

  const addDep = (
    fromSf: ts.SourceFile,
    fromRel: string,
    toRel: string,
    origin: 'import' | 'require',
    spec: string,
    node: ts.Node
  ) => {
    const fromMod = ensureFileModule(fromRel, ensurePkgIdForRel(fromRel));
    const toMod = ensureFileModule(toRel, ensurePkgIdForRel(toRel));
    const key = `${origin}:${fromRel}->${toRel}:${spec}`;
    if (seen.has(key)) return;
    seen.add(key);
    const id = hashId('r:', key);
    rels.push({
      id,
      kind: 'DEPENDENCY',
      sourceId: fromMod.id,
      targetId: toMod.id,
      taggedValues: [
        { key: 'origin', value: origin },
        { key: 'specifier', value: spec },
      ],
      source: sourceRefForNode(fromSf, node, projectRoot),
    });
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const fromRel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(fromRel)) continue;

    const visit = (n: ts.Node) => {
      // ES import/export from
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && (n as any).moduleSpecifier) {
        const ms = (n as any).moduleSpecifier;
        if (ts.isStringLiteral(ms)) {
          const spec = ms.text;
          const toRel = resolveToRel(spec, sf.fileName);
          if (toRel) addDep(sf, fromRel, toRel, 'import', spec, n);
          else if (report && spec.startsWith('.')) {
            addFinding(report, {
              kind: 'unresolvedImport',
              severity: 'warning',
              message: `Unresolved import '${spec}' from ${fromRel}`,
              location: { file: fromRel },
              tags: { specifier: spec, origin: 'import' },
            });
          }
        }
      }

      // CommonJS require('x')
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
        const arg0 = n.arguments[0];
        if (arg0 && ts.isStringLiteral(arg0)) {
          const spec = arg0.text;
          const toRel = resolveToRel(spec, sf.fileName);
          if (toRel) addDep(sf, fromRel, toRel, 'require', spec, n);
          else if (report && spec.startsWith('.')) {
            addFinding(report, {
              kind: 'unresolvedImport',
              severity: 'warning',
              message: `Unresolved require('${spec}') from ${fromRel}`,
              location: { file: fromRel },
              tags: { specifier: spec, origin: 'require' },
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  return rels;
}