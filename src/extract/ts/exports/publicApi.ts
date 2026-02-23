import ts from 'typescript';
import path from 'node:path';

import type { IrClassifier, IrRelation, IrRelationKind, IrSourceRef, IrTaggedValue } from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import type { EnsureFileModuleFn, IrPackageInfo } from '../context';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pos = node.getStart(sf, false);
  const lc = ts.getLineAndCharacterOfPosition(sf, pos);
  return { file: rel, line: lc.line + 1, col: lc.character + 1 };
}

function ensurePkgIdForRel(relFile: string, pkgByDir: Map<string, IrPackageInfo>): string {
  const pkgDir = toPosixPath(path.dirname(relFile));
  const pkgKey = pkgDir === '.' ? '' : pkgDir;
  const pkg = pkgByDir.get(pkgKey) ?? pkgByDir.get('')!;
  return pkg.id;
}

function ensureApiExportClassifier(args: {
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

function exportNameFromDecl(decl: ts.Declaration): string | null {
  // Named declarations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDecl: any = decl as any;
  if (anyDecl.name && ts.isIdentifier(anyDecl.name)) return anyDecl.name.text;
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function unwrapAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  if ((sym.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(sym);
    } catch {
      return sym;
    }
  }
  return sym;
}

function resolveSymbolDeclSourceFile(checker: ts.TypeChecker, sym: ts.Symbol): ts.SourceFile | null {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return null;
  return decl.getSourceFile();
}

export function extractPublicApiSurface(args: {
  program: ts.Program;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  projectRoot: string;
  scannedRel: string[];
  model: { classifiers: IrClassifier[] };
  pkgByDir: Map<string, IrPackageInfo>;
  ensureFileModule: EnsureFileModuleFn;
  report?: ExtractionReport;
}): { relations: IrRelation[] } {
  const { program, checker, compilerOptions, projectRoot, scannedRel, model, pkgByDir, ensureFileModule, report } = args;

  const relSet = new Set(scannedRel);
  const exportByFileAndName = new Map<string, IrClassifier>();

  const resolveToRel = (specifier: string, fromAbs: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, fromAbs, compilerOptions, ts.sys).resolvedModule;
    if (!resolved?.resolvedFileName) return null;
    const rf = resolved.resolvedFileName;
    if (rf.endsWith('.d.ts')) return null;
    const rel = toPosixPath(path.relative(projectRoot, rf));
    return relSet.has(rel) ? rel : null;
  };

  // 1) Collect exports
  for (const relFile of scannedRel) {
    const abs = path.resolve(projectRoot, relFile);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const pkgId = ensurePkgIdForRel(relFile, pkgByDir);
    const fileMod = ensureFileModule(relFile, pkgId);

    const addExport = (name: string, node: ts.Node) => {
      const exp = ensureApiExportClassifier({ model, projectRoot, relFile, exportName: name, node, sf, pkgId });
      exportByFileAndName.set(`${relFile}::${name}`, exp);
    };

    const visit = (n: ts.Node) => {
      // export class/func/interface/type/enum/const
      if ((ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) && hasExportModifier(n)) {
        const nm = n.name ? n.name.text : null;
        if (nm) addExport(nm, n);
      }
      if (ts.isVariableStatement(n) && hasExportModifier(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) addExport(d.name.text, d);
        }
      }
      // export { a as b } from './x'
      if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) {
          const name = (el.name && ts.isIdentifier(el.name)) ? el.name.text : null;
          if (name) addExport(name, el);
        }
      }
      // export * from './x' : not enumerable without checker; skip (consumers will resolve imports anyway)
      // export default ... : create as "default"
      if (ts.isExportAssignment(n)) {
        addExport('default', n);
      }

      ts.forEachChild(n, visit);
    };
    visit(sf);

    // Create fileModule -> ApiExport edges for all exports in this file
    // We'll do this after collection pass to avoid duplicates; here do quick scan of map keys for this file.
    for (const [k, exp] of exportByFileAndName.entries()) {
      if (!k.startsWith(`${relFile}::`)) continue;
      // relation created later, to keep consistent ordering in one place
      void exp;
    }

    // Ensure file module gets a stereotype to mark as public api surface when it has exports
    // (tag only; safe even if no exports)
    // We'll add tag later in relation creation if needed.
    void fileMod;
  }

  const rels: IrRelation[] = [];
  const seen = new Set<string>();

  const addRel = (kind: IrRelationKind, fromId: string, toId: string, sf: ts.SourceFile, node: ts.Node, tags: IrTaggedValue[]) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `PUBLICAPI:${kind}:${relFile}:${fromId}->${toId}:${tags.map((t) => `${t.key}=${t.value}`).join(';')}`);
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
