import ts from 'typescript';
import path from 'node:path';

import type { IrClassifier, IrRelation, IrRelationKind, IrTaggedValue } from '../../../../ir/irV1';
import { toPosixPath } from '../../../../util/id';
import type { ExtractionReport } from '../../../../report/extractionReport';
import { addFinding } from '../../../../report/reportBuilder';
import type { EnsureFileModuleFn, IrPackageInfo } from '../../context';
import { ensurePkgIdForRel, makePublicApiRelId, resolveSymbolDeclSourceFile, tag, unwrapAlias, sourceRefForNode } from './shared';

export function emitPublicApiSurface(args: {
  program: ts.Program;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  projectRoot: string;
  scannedRel: string[];
  exportByFileAndName: Map<string, IrClassifier>;
  pkgByDir: Map<string, IrPackageInfo>;
  ensureFileModule: EnsureFileModuleFn;
  report?: ExtractionReport;
}): { relations: IrRelation[] } {
  const { program, checker, compilerOptions, projectRoot, scannedRel, exportByFileAndName, pkgByDir, ensureFileModule, report } = args;

  const relSet = new Set(scannedRel);

  const resolveToRel = (specifier: string, fromAbs: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, fromAbs, compilerOptions, ts.sys).resolvedModule;
    if (!resolved?.resolvedFileName) return null;
    const rf = resolved.resolvedFileName;
    if (rf.endsWith('.d.ts')) return null;
    const rel = toPosixPath(path.relative(projectRoot, rf));
    return relSet.has(rel) ? rel : null;
  };

  const rels: IrRelation[] = [];
  const seen = new Set<string>();

  const addRel = (kind: IrRelationKind, fromId: string, toId: string, sf: ts.SourceFile, node: ts.Node, tags: IrTaggedValue[]) => {
    const { id } = makePublicApiRelId({ projectRoot, sf, kind, fromId, toId, tags });
    if (seen.has(id)) return;
    seen.add(id);
    rels.push({
      id,
      kind,
      sourceId: fromId,
      targetId: toId,
      taggedValues: tags,
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
  };

  // 2) FileModule -> ApiExport edges
  for (const [key, exp] of exportByFileAndName.entries()) {
    const [relFile, exportName] = key.split('::');
    const abs = path.resolve(projectRoot, relFile);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const pkgId = ensurePkgIdForRel(relFile, pkgByDir);
    const fileMod = ensureFileModule(relFile, pkgId);
    // mark file module as public api carrier
    fileMod.taggedValues = [...(fileMod.taggedValues ?? []), tag('origin', 'publicApi')];
    fileMod.stereotypes = [...(fileMod.stereotypes ?? []), { name: 'PublicApiFile' }];

    addRel('DEPENDENCY', fileMod.id, exp.id, sf, sf, [tag('origin', 'publicApi'), tag('role', 'exports'), tag('exportName', exportName)]);
  }

  // 3) Consumer imports -> ApiExport edges using checker resolution
  for (const relFile of scannedRel) {
    const abs = path.resolve(projectRoot, relFile);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const pkgId = ensurePkgIdForRel(relFile, pkgByDir);
    const consumerFileMod = ensureFileModule(relFile, pkgId);

    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const spec = n.moduleSpecifier.text;
        const targetRel = resolveToRel(spec, abs);
        const clause = n.importClause;
        if (!clause) return;

        // default import: import X from './m'
        if (clause.name) {
          const sym = checker.getSymbolAtLocation(clause.name);
          const declSf = sym ? resolveSymbolDeclSourceFile(checker, unwrapAlias(checker, sym)) : null;
          const targetFile = targetRel ?? (declSf ? toPosixPath(path.relative(projectRoot, declSf.fileName)) : null);
          if (targetFile) {
            const exp = exportByFileAndName.get(`${targetFile}::default`) ?? exportByFileAndName.get(`${targetFile}::${clause.name.text}`);
            if (exp) {
              addRel('DEPENDENCY', consumerFileMod.id, exp.id, sf, clause.name, [tag('origin', 'publicApi'), tag('role', 'imports'), tag('importName', 'default')]);
            }
          }
        }

        // named imports: import { a as b } from './m'
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = el.propertyName ? el.propertyName.text : el.name.text;
            // try resolve via checker
            const sym = checker.getSymbolAtLocation(el.name);
            const declSf = sym ? resolveSymbolDeclSourceFile(checker, unwrapAlias(checker, sym)) : null;
            const targetFile = targetRel ?? (declSf ? toPosixPath(path.relative(projectRoot, declSf.fileName)) : null);
            if (!targetFile) continue;

            const exp = exportByFileAndName.get(`${targetFile}::${imported}`);
            if (exp) {
              addRel('DEPENDENCY', consumerFileMod.id, exp.id, sf, el, [
                tag('origin', 'publicApi'),
                tag('role', 'imports'),
                tag('importName', imported),
                ...(el.propertyName ? [tag('localName', el.name.text)] : []),
              ]);
            } else if (report) {
              addFinding(report, {
                kind: 'note',
                severity: 'info',
                message: `Imported symbol not found in export index (may be re-export/export*): ${imported} from ${targetFile}`,
                location: { file: relFile },
              });
            }
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }

  return { relations: rels };
}
