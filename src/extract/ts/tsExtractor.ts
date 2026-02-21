import ts from 'typescript';
import path from 'node:path';
import { scanSourceFiles } from '../../scan/sourceScanner';
import {
  createEmptyIrModel,
  IrClassifier,
  IrModel,
  IrRelation,
  IrRelationKind,
  IrAttribute,
  IrTaggedValue,
  IrTypeRef,
  IrVisibility,
  IrClassifierKind,
  IrSourceRef,
} from '../../ir/irV1';
import { hashId, toPosixPath } from '../../util/id';
import { typeToIrTypeRef, typeNodeToIrTypeRef, collectReferencedTypeSymbols } from './typeRef';
import { canonicalizeIrModel } from '../../ir/canonicalizeIrModel';
import type { ExtractionReport } from '../../report/extractionReport';
import { addFinding, incCount } from '../../report/reportBuilder';

export type TsExtractOptions = {
  projectRoot: string;
  tsconfigPath?: string;
  excludeGlobs?: string[];
  includeTests?: boolean;
  /** Optional safety cap; if set, results are truncated deterministically after sorting. */
  maxFiles?: number;

/** Include dependency relations (type deps + import graph edges) when enabled by CLI. */
includeDeps?: boolean;
/** Include framework-specific edges (React RENDER, Angular DI/NgModule) when enabled by CLI. */
includeFrameworkEdges?: boolean;
  /** Enable React conventions (components + RENDER edges). */
  react?: boolean;
  /** Enable Angular conventions (decorators + DI/module edges). */
  angular?: boolean;
  /** Force allowJs/checkJs settings regardless of tsconfig (Step 7 JavaScript support). */
  forceAllowJs?: boolean;
  /** Emit module classifiers + file-level import dependency edges. */
  importGraph?: boolean;
  /** Optional extraction report to populate. */
  report?: ExtractionReport;
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

function isStatic(mods: readonly ts.Modifier[] | undefined): boolean | undefined {
  if (!mods) return undefined;
  return mods.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ? true : undefined;
}

function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  return { file: rel, line: pos.line + 1, col: pos.character + 1 };
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
  const pkgByDir = new Map<
    string,
    { id: string; name: string; qualifiedName: string | null; parentId: string | null }
  >();

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

export async function extractTypeScriptStructuralModel(opts: TsExtractOptions) {
  const projectRoot = path.resolve(opts.projectRoot);
  const excludeGlobs = opts.excludeGlobs ?? [];
  const includeTests = !!opts.includeTests;

  const scannedRel = await scanSourceFiles({
    sourceRoot: projectRoot,
    excludeGlobs,
    includeTests,
    maxFiles: opts.maxFiles,
  });
  const scannedAbs = scannedRel.map((r) => path.resolve(projectRoot, r));

  if (opts.report) {
    opts.report.filesScanned = scannedRel.length;
    opts.report.filesProcessed = 0; // updated after program created
  }

  // Respect tsconfig options if present (but we still control rootNames via scanner)
  const configPath = opts.tsconfigPath
    ? path.resolve(projectRoot, opts.tsconfigPath)
    : ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');

  let compilerOptions: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true };
  if (configPath && ts.sys.fileExists(configPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
      if (!parsed.errors?.length) compilerOptions = { ...parsed.options, noEmit: true };
    }
  }

  // Step 7: ensure JavaScript can be analyzed even if tsconfig disables it.
  if (opts.forceAllowJs) {
    compilerOptions = {
      ...compilerOptions,
      allowJs: true,
      checkJs: false,
      noEmit: true,
    };
  }

  const program = ts.createProgram({
    rootNames: scannedAbs,
    options: compilerOptions,
  });
  const checker = program.getTypeChecker();

  if (opts.report) {
    // program.getSourceFiles includes lib files; count only our scanned set.
    opts.report.filesProcessed = scannedRel.length;
  }

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
      source: { file: relFile, line: 1, col: 1 },
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
        source: sourceRefForNode(sf, node, projectRoot),
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
      };
      classifierById.set(id, cls);
      declared.set(sym, { id, kind });
    };

    sf.forEachChild((node) => {
      // Standard top-level declarations (class/interface/enum/type/function)
      const kind = classifierKindFromNode(node);
      if (kind) {
        const nm = (node as any).name?.text as string | undefined;
        if (!nm) return;
        const sym = checker.getSymbolAtLocation((node as any).name);
        if (!sym) return;
        addClassifier(node, nm, kind, sym);
        return;
      }

      // Also treat top-level const/let assignments of arrow/function expressions as FUNCTION classifiers.
      // This makes the extractor resilient and lets React enrichment upgrade these to COMPONENT.
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const init = d.initializer;
          if (!init) continue;
          if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;

          const nm = d.name.text;
          const sym = checker.getSymbolAtLocation(d.name);
          if (!sym) continue;
          addClassifier(d, nm, 'FUNCTION', sym);
        }
      }
    });
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;
    declareInSourceFile(sf);
  }

  // Second pass: members + relations
  const relations: IrRelation[] = [];
  const addRelation = (
    kind: IrRelation['kind'],
    sourceId: string,
    targetId: string,
    name?: string | null,
    src?: IrSourceRef | null,
  ) => {
    if (kind === 'DEPENDENCY' && !opts.includeDeps) return;
    const rid = hashId('r:', `${kind}:${sourceId}->${targetId}:${name ?? ''}`);
    relations.push({ id: rid, kind, sourceId, targetId, name: name ?? null, source: src ?? null });
  };

  const resolveSymbolToClassifierId = (sym: ts.Symbol | undefined): string | null => {
    if (!sym) return null;
    const direct = declared.get(sym);
    if (direct) return direct.id;
    const aliased = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : null;
    if (aliased) {
      const d2 = declared.get(aliased);
      if (d2) return d2.id;
    }
    return null;
  };

  const referencedIdsFromType = (type: ts.Type): string[] => {
    const syms = new Set<ts.Symbol>();
    collectReferencedTypeSymbols(type, checker, syms);
    const ids = new Set<string>();
    for (const s of syms) {
      const id = resolveSymbolToClassifierId(s);
      if (id) ids.add(id);
    }
    return Array.from(ids).sort();
  };

  const fillInSourceFile = (sf: ts.SourceFile) => {
    sf.forEachChild((node) => {
      const kind = classifierKindFromNode(node);
      if (!kind) return;

      const nm = (node as any).name?.text as string | undefined;
      if (!nm) return;

      const sym = checker.getSymbolAtLocation((node as any).name);
      if (!sym) return;

      const declInfo = declared.get(sym);
      if (!declInfo) return;

      const cls = classifierById.get(declInfo.id);
      if (!cls) return;

      cls.visibility = visibilityFromModifiers((node as any).modifiers);

      // Heritage
      const heritage = (node as any).heritageClauses as ts.NodeArray<ts.HeritageClause> | undefined;
      if (heritage) {
        for (const hc of heritage) {
          for (const t of hc.types) {
            const ht = checker.getTypeAtLocation(t);
            const hs = ht.getSymbol();
            const targetId = resolveSymbolToClassifierId(hs ?? undefined);
            if (!targetId) continue;
            const src = sourceRefForNode(sf, t, projectRoot);

            if (hc.token === ts.SyntaxKind.ExtendsKeyword) addRelation('GENERALIZATION', cls.id, targetId, null, src);
            if (hc.token === ts.SyntaxKind.ImplementsKeyword) addRelation('REALIZATION', cls.id, targetId, null, src);
          }
        }
      }

      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        for (const member of node.members) {
          // Attributes
          if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
            const name = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
            if (!name) continue;

            const type = member.type ? checker.getTypeFromTypeNode(member.type) : checker.getTypeAtLocation(member);
            cls.attributes!.push({
              id: hashId('a:', `${cls.id}:${name}`),
              name,
              visibility: visibilityFromModifiers((member as any).modifiers),
              isStatic: isStatic((member as any).modifiers),
              isFinal: (member as any).modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
                ? true
                : undefined,
              type: (member as any).type ? typeNodeToIrTypeRef((member as any).type, checker) : typeToIrTypeRef(type, checker),
              source: sourceRefForNode(sf, member, projectRoot),
            });

            // Associations for referenced types
            for (const refId of referencedIdsFromType(type)) {
              if (refId === cls.id) continue;
              addRelation('ASSOCIATION', cls.id, refId, name, sourceRefForNode(sf, member, projectRoot));
            }
          }

          // Operations
          if (ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
            const isCtor = ts.isConstructorDeclaration(member);
            const name = isCtor
              ? cls.name
              : member.name && ts.isIdentifier(member.name)
                ? member.name.text
                : undefined;
            if (!name) continue;

            const sig = checker.getSignatureFromDeclaration(member as ts.SignatureDeclaration);
            // IMPORTANT: keep this expression contextually typed as IrTypeRef so literal 'kind' values
            // don't get widened to plain `string` in older TS inference edge-cases.
            const returnType: import('../../ir/irV1').IrTypeRef = isCtor
              ? { kind: 'NAMED', name: cls.name }
              : sig
                ? ((member as any).type ? typeNodeToIrTypeRef((member as any).type, checker) : typeToIrTypeRef(checker.getReturnTypeOfSignature(sig), checker))
                : { kind: 'UNKNOWN', name: 'unknown' };

            const parameters = (member as ts.SignatureDeclaration).parameters.map((p) => {
              const pn = ts.isIdentifier(p.name) ? p.name.text : 'param';
              const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
              return { name: pn, type: p.type ? typeNodeToIrTypeRef(p.type, checker) : typeToIrTypeRef(pt, checker) };
            });

            cls.operations!.push({
              id: hashId('o:', `${cls.id}:${name}:${isCtor ? 'ctor' : 'm'}`),
              name,
              visibility: visibilityFromModifiers((member as any).modifiers),
              isStatic: isStatic((member as any).modifiers),
              isAbstract: (member as any).modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.AbstractKeyword)
                ? true
                : undefined,
              isConstructor: isCtor ? true : undefined,
              returnType,
              parameters,
              source: sourceRefForNode(sf, member, projectRoot),
            });

            // Dependencies from param/return types
            for (const p of (member as ts.SignatureDeclaration).parameters) {
              const pt = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
              for (const refId of referencedIdsFromType(pt)) {
                if (refId === cls.id) continue;
                addRelation('DEPENDENCY', cls.id, refId, 'param', sourceRefForNode(sf, p, projectRoot));
              }
            }
            if (!isCtor && sig) {
              const rt = checker.getReturnTypeOfSignature(sig);
              for (const refId of referencedIdsFromType(rt)) {
                if (refId === cls.id) continue;
                addRelation('DEPENDENCY', cls.id, refId, 'return', sourceRefForNode(sf, member, projectRoot));
              }
            }
          }
        }
      }

      if (ts.isFunctionDeclaration(node)) {
        const sig = node.name ? checker.getSignatureFromDeclaration(node) : undefined;
        if (sig) {
          cls.operations!.push({
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
    });
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;
    fillInSourceFile(sf);
  }

  model.classifiers = Array.from(classifierById.values());
  model.relations = relations;

  if (opts.react) {
    enrichReactModel({
      program,
      checker,
      projectRoot,
      scannedRel,
      model,
      report: opts.report,
      includeFrameworkEdges: opts.includeFrameworkEdges,
    });
  }

  if (opts.angular) {
    enrichAngularModel({
      program,
      checker,
      projectRoot,
      scannedRel,
      model,
      report: opts.report,
      includeFrameworkEdges: opts.includeFrameworkEdges,
      includeDeps: opts.includeDeps,
    });
  }

  if (opts.importGraph) {
    const extra = extractImportGraphRelations({
      program,
      compilerOptions,
      projectRoot,
      scannedRel,
      ensureFileModule: (relFile: string, pkgId: string) => ensureFileModule(relFile, pkgId),
      pkgByDir,
      report: opts.report,
    });
    model.relations = [...(model.relations ?? []), ...extra];
    // module classifiers were already inserted into classifierById via ensureFileModule.
    model.classifiers = Array.from(classifierById.values());
  }

  // Step 8: populate report counts + unresolved tracking.
  if (opts.report) {
    for (const c of model.classifiers) incCount(opts.report.counts.classifiersByKind, c.kind);
    for (const r of model.relations ?? []) incCount(opts.report.counts.relationsByKind, r.kind);

    const classifierByName = new Map<string, IrClassifier>();
    for (const c of model.classifiers) classifierByName.set(c.name, c);

    const isBuiltin = (name: string) =>
      [
        'string',
        'number',
        'boolean',
        'bigint',
        'void',
        'never',
        'any',
        'unknown',
        'Array',
        'ReadonlyArray',
        'Promise',
        'Record',
        'Map',
        'Set',
        'Date',
        'RegExp',
        'Error',
        'Function',
        'Object',
        'String',
        'Number',
        'Boolean',
      ].includes(name);

    const collectNamed = (tr: IrTypeRef | null | undefined, out: Set<string>) => {
      if (!tr) return;
      if (tr.kind === 'NAMED') {
        if (tr.name) out.add(tr.name);
        return;
      }
      if (tr.kind === 'GENERIC') {
        if (tr.name) out.add(tr.name);
        (tr.typeArgs ?? []).forEach((a) => collectNamed(a, out));
        return;
      }
      if (tr.kind === 'ARRAY') {
        collectNamed(tr.elementType, out);
        return;
      }
      if (tr.kind === 'UNION' || tr.kind === 'INTERSECTION') {
        (tr.typeArgs ?? []).forEach((a) => collectNamed(a, out));
      }
    };

    for (const c of model.classifiers) {
      const locFile = c.source?.file;
      const line = c.source?.line ?? undefined;
      const col = (c.source as any)?.col ?? undefined;
      const baseLoc = locFile ? { file: locFile, line: line === null ? undefined : line, column: col } : undefined;

      for (const a of c.attributes ?? []) {
        const names = new Set<string>();
        collectNamed(a.type, names);
        for (const nm of names) {
          if (isBuiltin(nm)) continue;
          if (!classifierByName.has(nm)) {
            addFinding(opts.report, {
              kind: 'unresolvedType',
              severity: 'warning',
              message: `Unresolved attribute type '${nm}' on ${c.name}.${a.name}`,
              location: baseLoc,
              tags: { owner: c.name, member: a.name, role: 'attribute', type: nm },
            });
          }
        }
      }

      for (const op of c.operations ?? []) {
        const names = new Set<string>();
        collectNamed(op.returnType, names);
        for (const p of op.parameters ?? []) collectNamed(p.type, names);
        for (const nm of names) {
          if (isBuiltin(nm)) continue;
          if (!classifierByName.has(nm)) {
            addFinding(opts.report, {
              kind: 'unresolvedType',
              severity: 'warning',
              message: `Unresolved operation type '${nm}' on ${c.name}.${op.name}()` ,
              location: baseLoc,
              tags: { owner: c.name, member: op.name, role: 'operation', type: nm },
            });
          }
        }
      }
    }
  }

  return canonicalizeIrModel(model);
}

type ImportGraphContext = {
  program: ts.Program;
  compilerOptions: ts.CompilerOptions;
  projectRoot: string;
  scannedRel: string[];
  pkgByDir: Map<string, { id: string; name: string; qualifiedName: string | null; parentId: string | null }>;
  ensureFileModule: (relFile: string, pkgId: string) => IrClassifier;
  report?: ExtractionReport;
};

function extractImportGraphRelations(ctx: ImportGraphContext): IrRelation[] {
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

type ReactEnrichContext = {
  program: ts.Program;
  checker: ts.TypeChecker;
  projectRoot: string;
  scannedRel: string[];
  model: IrModel;
  report?: ExtractionReport;
  includeFrameworkEdges?: boolean;
};

function enrichReactModel(ctx: ReactEnrichContext) {
  const { program, projectRoot, scannedRel, model, report, includeFrameworkEdges } = ctx;

  const classifierByFileAndName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) {
    const file = c.source?.file;
    if (!file) continue;
    classifierByFileAndName.set(`${file}::${c.name}`, c);
  }

  const checker = program.getTypeChecker();

  const isPascalCase = (s: string) => /^[A-Z][A-Za-z0-9_]*$/.test(s);
  const hasStereotype = (c: IrClassifier, name: string) => (c.stereotypes ?? []).some((st) => st.name === name);
  const addStereo = (c: IrClassifier, name: string) => {
    c.stereotypes = c.stereotypes ?? [];
    if (!hasStereotype(c, name)) c.stereotypes.push({ name });
  };
  const setTag = (c: IrClassifier, key: string, value: string) => {
    c.taggedValues = c.taggedValues ?? [];
    const existing = c.taggedValues.find((tv) => tv.key === key);
    if (existing) existing.value = value;
    else c.taggedValues.push({ key, value });
  };

  // React Context helpers
  const hasContextStereo = (c: IrClassifier) => (c.stereotypes ?? []).some((st) => st.name === 'ReactContext');
  const ensureContextClassifier = (sf: ts.SourceFile, node: ts.Node, name: string, typeNode?: ts.TypeNode | null) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

    const key = `${relFile}::${name}`;
    let c = classifierByFileAndName.get(key);
    if (!c) {
      const existing = model.classifiers.filter((x) => x.name === name && hasContextStereo(x));
      if (existing.length === 1) c = existing[0];
    }

    if (!c) {
      const id = hashId('c:', `REACT_CONTEXT:${relFile}:${name}`);
      c = {
        id,
        name,
        qualifiedName: name,
        packageId: pkgId,
        kind: 'SERVICE',
        source: sourceRefForNode(sf, node, projectRoot),
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
      };
      model.classifiers.push(c);
      classifierByFileAndName.set(key, c);
    }

    c.kind = 'SERVICE';
    addStereo(c, 'ReactContext');
    setTag(c, 'framework', 'react');
    if (typeNode) setTag(c, 'react.contextType', typeNode.getText(sf));
    return c;
  };

const upsertAttr = (c: IrClassifier, name: string, type: IrTypeRef, role: 'props' | 'state') => {
  c.attributes = c.attributes ?? [];
  let a = c.attributes.find((x) => x.name === name);
  if (!a) {
    a = { name, type, taggedValues: [] };
    c.attributes.push(a);
  } else {
    a.type = type;
  }
  a.taggedValues = a.taggedValues ?? [];
  const existing = a.taggedValues.find((tv) => tv.key === 'react.role');
  if (existing) existing.value = role;
  else a.taggedValues.push({ key: 'react.role', value: role });
};

const applyReactPropsState = (
  c: IrClassifier,
  sf: ts.SourceFile,
  propsTypeNode?: ts.TypeNode | null,
  stateTypeNode?: ts.TypeNode | null,
) => {
  if (propsTypeNode) {
    const propsType = typeNodeToIrTypeRef(propsTypeNode, checker);
    upsertAttr(c, 'props', propsType, 'props');
    setTag(c, 'react.propsType', propsTypeNode.getText(sf));
  }
  if (stateTypeNode) {
    const stateType = typeNodeToIrTypeRef(stateTypeNode, checker);
    upsertAttr(c, 'state', stateType, 'state');
    setTag(c, 'react.stateType', stateTypeNode.getText(sf));
  }
};

const isReactFctype = (tn: ts.TypeNode, sf: ts.SourceFile): ts.TypeNode | null => {
  if (!ts.isTypeReferenceNode(tn)) return null;
  const typeName = tn.typeName.getText(sf);
  const isFc =
    typeName === 'React.FC' ||
    typeName === 'FC' ||
    typeName === 'React.FunctionComponent' ||
    typeName === 'FunctionComponent' ||
    typeName.endsWith('.FC') ||
    typeName.endsWith('.FunctionComponent');
  if (!isFc) return null;
  const args = tn.typeArguments ?? [];
  return args.length >= 1 ? args[0] : null;
};
  const ensureComponentClassifier = (sf: ts.SourceFile, node: ts.Node, name: string): IrClassifier => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const key = `${relFile}::${name}`;
    let c = classifierByFileAndName.get(key);

    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

    if (!c) {
      const qn = name;
      const id = hashId('c:', `COMPONENT:${relFile}:${qn}`);
      c = {
        id,
        name,
        qualifiedName: qn,
        packageId: pkgId,
        kind: 'COMPONENT',
        source: sourceRefForNode(sf, node, projectRoot),
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
      };
      model.classifiers.push(c);
      classifierByFileAndName.set(key, c);
    }

    c.kind = 'COMPONENT';
    addStereo(c, 'ReactComponent');
    setTag(c, 'framework', 'react');
    return c;
  };

  // 1) Detect components
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    const visit = (node: ts.Node) => {
      // const Ctx = React.createContext<T>(...) / createContext<T>(...)
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          const init = d.initializer;
          if (!init || !ts.isCallExpression(init)) continue;

          const callee = init.expression;
          const calleeName = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : undefined;

          if (calleeName !== 'createContext') continue;
          const typeArg = init.typeArguments?.[0] ?? null;
          ensureContextClassifier(sf, d, nm, typeArg);
        }
      }

      // class Foo extends React.Component / Component
      if (ts.isClassDeclaration(node) && node.name?.text && isPascalCase(node.name.text)) {
        const extendsClause = (node.heritageClauses ?? []).find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
        const t = extendsClause?.types?.[0];
        if (t) {
          const txt = t.expression.getText(sf);
          if (txt === 'React.Component' || txt === 'Component' || txt.endsWith('.Component')) {
            const c = ensureComponentClassifier(sf, node, node.name.text);
            setTag(c, 'react.componentKind', 'class');
            applyReactPropsState(c, sf, t.typeArguments?.[0] ?? null, t.typeArguments?.[1] ?? null);
          }
        }
      }

      // function Foo() { return <div/> }
      if (ts.isFunctionDeclaration(node) && node.name?.text && isPascalCase(node.name.text)) {
        if (functionLikeReturnsJsx(node, sf)) {
          const c = ensureComponentClassifier(sf, node, node.name.text);
          setTag(c, 'react.componentKind', 'function');
          applyReactPropsState(c, sf, node.parameters[0]?.type ?? null, null);
        }
      }

      // const Foo = () => <div/> or function() { return <div/> }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          if (!isPascalCase(nm)) continue;
          const init = d.initializer;
          if (!init) continue;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (functionLikeReturnsJsx(init, sf)) {
              const c = ensureComponentClassifier(sf, d, nm);
              setTag(c, 'react.componentKind', 'function');
              applyReactPropsState(c, sf, init.parameters[0]?.type ?? null, null);
              if (d.type) {
                const fcArg = isReactFctype(d.type, sf);
                if (fcArg) applyReactPropsState(c, sf, fcArg, null);
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  const componentIdByName = new Map<string, string>();
  for (const c of model.classifiers) {
    if (c.kind === 'COMPONENT') componentIdByName.set(c.name, c.id);
  }
  if (!componentIdByName.size) return;

  const contextIdByName = new Map<string, string>();
  for (const c of model.classifiers) {
    if (hasContextStereo(c)) contextIdByName.set(c.name, c.id);
  }

  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) existingKeys.add(`RENDER:${r.sourceId}:${r.targetId}`);

  const existingDiKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    if (r.kind === 'DI') {
      const origin = (r.taggedValues ?? []).find((tv) => tv.key === 'origin')?.value ?? '';
      existingDiKeys.add(`DI:${r.sourceId}:${r.targetId}:${origin}`);
    }
  }

  const addDi = (sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node, origin: string) => {
    if (includeFrameworkEdges === false) return;
    if (fromId === toId) return;
    const key = `DI:${fromId}:${toId}:${origin}`;
    if (existingDiKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `DI:${relFile}:${fromId}->${toId}:${origin}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind: 'DI',
      sourceId: fromId,
      targetId: toId,
      taggedValues: [{ key: 'origin', value: origin }],
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingDiKeys.add(key);
  };

  const addRender = (sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node) => {
    if (includeFrameworkEdges === false) return;
    if (fromId === toId) return;
    const key = `RENDER:${fromId}:${toId}`;
    if (existingKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `RENDER:${relFile}:${fromId}->${toId}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind: 'RENDER',
      sourceId: fromId,
      targetId: toId,
      taggedValues: [{ key: 'origin', value: 'jsx' }],
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingKeys.add(key);
  };

  const scanJsx = (sf: ts.SourceFile, root: ts.Node, ownerName: string) => {
    const fromId = componentIdByName.get(ownerName);
    if (!fromId) return;

    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n)) {
        const tag = jsxTagNameToString(n.tagName);
        const toId = tag ? componentIdByName.get(tag) : undefined;
        if (toId) addRender(sf, fromId, toId, n);
        else if (report && tag && isPascalCase(tag)) {
          addFinding(report, {
            kind: 'unresolvedJsxComponent',
            severity: 'warning',
            message: `JSX renders '${tag}' but no matching component classifier was found`,
            location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
            tags: { owner: ownerName, tag },
          });
        }

        // <Ctx.Provider />
        if (ts.isPropertyAccessExpression(n.tagName) && n.tagName.name.text === 'Provider') {
          const ctxExpr = n.tagName.expression;
          if (ts.isIdentifier(ctxExpr)) {
            const ctxName = ctxExpr.text;
            const ctxId = contextIdByName.get(ctxName);
            if (ctxId) addDi(sf, fromId, ctxId, n, 'provider');
            else if (report) {
              addFinding(report, {
                kind: 'unresolvedContext',
                severity: 'warning',
                message: `JSX Provider for '${ctxName}' but no matching context classifier was found`,
                location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                tags: { owner: ownerName, context: ctxName, origin: 'provider' },
              });
            }
          }
        }
      } else if (ts.isJsxOpeningElement(n)) {
        const tag = jsxTagNameToString(n.tagName);
        const toId = tag ? componentIdByName.get(tag) : undefined;
        if (toId) addRender(sf, fromId, toId, n);
        else if (report && tag && isPascalCase(tag)) {
          addFinding(report, {
            kind: 'unresolvedJsxComponent',
            severity: 'warning',
            message: `JSX renders '${tag}' but no matching component classifier was found`,
            location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
            tags: { owner: ownerName, tag },
          });
        }

        // <Ctx.Provider>
        if (ts.isPropertyAccessExpression(n.tagName) && n.tagName.name.text === 'Provider') {
          const ctxExpr = n.tagName.expression;
          if (ts.isIdentifier(ctxExpr)) {
            const ctxName = ctxExpr.text;
            const ctxId = contextIdByName.get(ctxName);
            if (ctxId) addDi(sf, fromId, ctxId, n, 'provider');
            else if (report) {
              addFinding(report, {
                kind: 'unresolvedContext',
                severity: 'warning',
                message: `JSX Provider for '${ctxName}' but no matching context classifier was found`,
                location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                tags: { owner: ownerName, context: ctxName, origin: 'provider' },
              });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };

  const scanUseContext = (sf: ts.SourceFile, root: ts.Node, ownerName: string) => {
    const fromId = componentIdByName.get(ownerName);
    if (!fromId) return;

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const calleeName = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : undefined;

        if (calleeName === 'useContext') {
          const arg0 = n.arguments[0];
          if (arg0) {
            let ctxName: string | undefined;
            if (ts.isIdentifier(arg0)) ctxName = arg0.text;
            else if (ts.isPropertyAccessExpression(arg0)) ctxName = arg0.name.text;

            if (ctxName) {
              const ctxId = contextIdByName.get(ctxName);
              if (ctxId) addDi(sf, fromId, ctxId, n, 'useContext');
              else if (report) {
                addFinding(report, {
                  kind: 'unresolvedContext',
                  severity: 'warning',
                  message: `useContext('${ctxName}') but no matching context classifier was found`,
                  location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                  tags: { owner: ownerName, context: ctxName, origin: 'useContext' },
                });
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };

    visit(root);
  };

  // 2) Add RENDER edges
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text && componentIdByName.has(node.name.text)) {
        scanJsx(sf, node, node.name.text);
        scanUseContext(sf, node, node.name.text);
      }
      if (ts.isClassDeclaration(node) && node.name?.text && componentIdByName.has(node.name.text)) {
        scanJsx(sf, node, node.name.text);
        scanUseContext(sf, node, node.name.text);
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          const init = d.initializer;
          if (!init) continue;
          if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && componentIdByName.has(nm)) {
            scanJsx(sf, init, nm);
            scanUseContext(sf, init, nm);
          }
        }
      }
    });
  }
}

function functionLikeReturnsJsx(fn: ts.SignatureDeclarationBase, sf: ts.SourceFile): boolean {
  const anyFn: any = fn as any;

  const unwrap = (expr: ts.Expression): ts.Expression => {
    let e: ts.Expression = expr;
    // ParenthesizedExpression exists in TS 5+; in older versions it's a syntax kind wrapper too.
    // Use the public type guard when available.
    while ((ts as any).isParenthesizedExpression?.(e) || e.kind === ts.SyntaxKind.ParenthesizedExpression) {
      e = (e as any).expression as ts.Expression;
      if (!e) break;
    }
    return e;
  };

  const isJsxExpr = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    return ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e);
  };

  // Expression-bodied arrow function
  if (anyFn.body && ts.isExpression(anyFn.body) && isJsxExpr(anyFn.body)) {
    return true;
  }

  const body = anyFn.body;
  if (!body || !ts.isBlock(body)) return false;

  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isReturnStatement(n) && n.expression && isJsxExpr(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function jsxTagNameToString(tag: ts.JsxTagNameExpression): string | null {
  return ts.isIdentifier(tag) ? tag.text : null;
}

type AngularEnrichContext = {
  program: ts.Program;
  checker: ts.TypeChecker;
  projectRoot: string;
  scannedRel: string[];
  model: IrModel;
  report?: ExtractionReport;
  includeFrameworkEdges?: boolean;
  includeDeps?: boolean;
};

function enrichAngularModel(ctx: AngularEnrichContext) {
  const { program, checker, projectRoot, scannedRel, model, report, includeFrameworkEdges, includeDeps } = ctx;

  const classifierByName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) classifierByName.set(c.name, c);

  const hasStereotype = (c: IrClassifier, name: string) => (c.stereotypes ?? []).some((st) => st.name === name);
  const addStereo = (c: IrClassifier, name: string) => {
    c.stereotypes = c.stereotypes ?? [];
    if (!hasStereotype(c, name)) c.stereotypes.push({ name });
  };
  const setTag = (c: IrClassifier, key: string, value: string) => {
    c.taggedValues = c.taggedValues ?? [];
    const existing = c.taggedValues.find((tv) => tv.key === key);
    if (existing) existing.value = value;
    else c.taggedValues.push({ key, value });
  };

  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    const role = (r.taggedValues ?? []).find((tv) => tv.key === 'role')?.value ?? '';
    existingKeys.add(`${r.kind}:${r.sourceId}:${r.targetId}:${role}`);
  }

  const addRelation = (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags: IrTaggedValue[],
  ) => {
    if (includeFrameworkEdges === false) return;
    const role = tags.find((t) => t.key === 'role')?.value ?? '';
    const key = `${kind}:${fromId}:${toId}:${role}`;
    if (existingKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `${kind}:${relFile}:${fromId}->${toId}:${role}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind,
      sourceId: fromId,
      targetId: toId,
      taggedValues: tags,
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingKeys.add(key);
  };

  const getDecorators = (node: ts.Node): ts.Decorator[] => {
    const anyTs: any = ts as any;
    if (typeof anyTs.getDecorators === 'function') return anyTs.getDecorators(node) ?? [];
    return (node as any).decorators ?? [];
  };

  const decoratorCallName = (d: ts.Decorator, sf: ts.SourceFile): string | undefined => {
    const expr = d.expression;
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isIdentifier(callee)) return callee.text;
      if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
      return callee.getText(sf);
    }
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return undefined;
  };

  const getDecoratorArgObject = (d: ts.Decorator): ts.ObjectLiteralExpression | undefined => {
    const expr = d.expression;
    if (!ts.isCallExpression(expr)) return undefined;
    const arg0 = expr.arguments[0];
    return arg0 && ts.isObjectLiteralExpression(arg0) ? arg0 : undefined;
  };

  const readStringProp = (obj: ts.ObjectLiteralExpression, name: string, sf: ts.SourceFile): string | undefined => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (pn !== name) continue;
      const init = p.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
      return init.getText(sf);
    }
    return undefined;
  };

  const readArrayIdentifiers = (obj: ts.ObjectLiteralExpression, name: string): string[] => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (pn !== name) continue;
      const init = p.initializer;
      if (!ts.isArrayLiteralExpression(init)) return [];
      const out: string[] = [];
      for (const e of init.elements) {
        if (ts.isIdentifier(e)) out.push(e.text);
        else if (ts.isPropertyAccessExpression(e)) out.push(e.name.text);
      }
      return out;
    }
    return [];
  };

  const getTypeNameFromParam = (p: ts.ParameterDeclaration): string | undefined => {
    const t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
    const sym = t.getSymbol() ?? (t as any).aliasSymbol;
    const n = sym?.getName();
    return n && n !== '__type' ? n : undefined;
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name?.text) {
        const c = classifierByName.get(node.name.text);
        if (!c) {
          ts.forEachChild(node, visit);
          return;
        }

        const decorators = getDecorators(node);
        if (!decorators.length) {
          ts.forEachChild(node, visit);
          return;
        }

        const decNames = decorators.map((d) => decoratorCallName(d, sf)).filter(Boolean) as string[];
        const isComponent = decNames.includes('Component');
        const isInjectable = decNames.includes('Injectable');
        const isNgModule = decNames.includes('NgModule');

        if (isComponent || isInjectable || isNgModule) setTag(c, 'framework', 'angular');

        if (isComponent) {
          c.kind = 'COMPONENT';
          addStereo(c, 'AngularComponent');
          setTag(c, 'angular.decorator', 'Component');
          const d = decorators.find((dd) => decoratorCallName(dd, sf) === 'Component');
          const obj = d ? getDecoratorArgObject(d) : undefined;
          if (obj) {
            const selector = readStringProp(obj, 'selector', sf);
            const templateUrl = readStringProp(obj, 'templateUrl', sf);
            if (selector) setTag(c, 'angular.selector', selector);
            if (templateUrl) setTag(c, 'angular.templateUrl', templateUrl);
          }
        }

        if (isInjectable) {
          c.kind = 'SERVICE';
          addStereo(c, 'AngularInjectable');
          setTag(c, 'angular.decorator', 'Injectable');
        }

        if (isNgModule) {
          c.kind = 'MODULE';
          addStereo(c, 'AngularNgModule');
          setTag(c, 'angular.decorator', 'NgModule');
          const d = decorators.find((dd) => decoratorCallName(dd, sf) === 'NgModule');
          const obj = d ? getDecoratorArgObject(d) : undefined;
          if (obj) {
            for (const role of ['imports', 'providers', 'declarations'] as const) {
              const names = readArrayIdentifiers(obj, role);
              for (const nm of names) {
                const to = classifierByName.get(nm);
                if (to) {
                  addRelation(sf, 'DEPENDENCY', c.id, to.id, node, [
                    { key: 'origin', value: 'ngmodule' },
                    { key: 'role', value: role },
                  ]);
                }
                else if (report) {
                  addFinding(report, {
                    kind: 'unresolvedDecoratorRef',
                    severity: 'warning',
                    message: `NgModule ${role} references '${nm}' but it was not found as a classifier`,
                    location: { file: rel },
                    tags: { owner: c.name, role, ref: nm },
                  });
                }
              }
            }
          }
        }

        // Step 11: Inputs/Outputs extraction (component API)
        if (isComponent) {
          const ensureAttr = (name: string, typeRef: IrTypeRef, sourceNode: ts.Node): IrAttribute => {
            c.attributes = c.attributes ?? [];
            const existing = c.attributes.find((a) => a.name === name);
            if (existing) return existing;
            const id = hashId('a:', `${c.id}:${name}:${rel}:${sourceNode.pos}`);
            const attr: IrAttribute = {
              id,
              name,
              type: typeRef,
              source: sourceRefForNode(sf, sourceNode, projectRoot),
            };
            c.attributes.push(attr);
            return attr;
          };

          const setAttrTag = (a: IrAttribute, key: string, value: string) => {
            a.taggedValues = a.taggedValues ?? [];
            const tv = a.taggedValues.find((t) => t.key === key);
            if (tv) tv.value = value;
            else a.taggedValues.push({ key, value });
          };

          const decoratorArgString0 = (d: ts.Decorator): string | undefined => {
            const expr = d.expression;
            if (!ts.isCallExpression(expr)) return undefined;
            const a0 = expr.arguments[0];
            if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) return a0.text;
            return undefined;
          };

          const extractEventEmitterPayloadName = (member: ts.ClassElement): string | undefined => {
            // Prefer explicit type annotation: EventEmitter<T>
            const anyMember: any = member as any;
            if (anyMember.type && ts.isTypeReferenceNode(anyMember.type)) {
              const tr = anyMember.type as ts.TypeReferenceNode;
              const tn = tr.typeName;
              const nm = ts.isIdentifier(tn) ? tn.text : ts.isQualifiedName(tn) ? tn.right.text : undefined;
              if (nm === 'EventEmitter' && tr.typeArguments?.length) return tr.typeArguments[0].getText(sf);
            }
            // Or initializer: new EventEmitter<T>()
            if (ts.isPropertyDeclaration(member) && member.initializer && ts.isNewExpression(member.initializer)) {
              const ne = member.initializer;
              const ex = ne.expression;
              const nm = ts.isIdentifier(ex) ? ex.text : undefined;
              if (nm === 'EventEmitter' && ne.typeArguments?.length) return ne.typeArguments[0].getText(sf);
            }
            return undefined;
          };

          const memberName = (m: ts.ClassElement): string | undefined => {
            const anyM: any = m as any;
            const nameNode: ts.PropertyName | undefined = anyM.name;
            if (!nameNode) return undefined;
            if (ts.isIdentifier(nameNode)) return nameNode.text;
            if (ts.isStringLiteral(nameNode)) return nameNode.text;
            return undefined;
          };

          const handleInputOutput = (m: ts.ClassElement) => {
            const decs = getDecorators(m);
            if (!decs.length) return;
            const names = decs.map((d) => decoratorCallName(d, sf)).filter(Boolean) as string[];
            if (!names.includes('Input') && !names.includes('Output')) return;
            const propName = memberName(m);
            if (!propName) return;

            const anyM: any = m as any;
            const typeRef: IrTypeRef = anyM.type
              ? typeNodeToIrTypeRef(anyM.type as ts.TypeNode, checker)
              : { kind: 'UNKNOWN', name: 'unknown' };

            const attr = ensureAttr(propName, typeRef, m);

            if (names.includes('Input')) {
              setAttrTag(attr, 'angular.role', 'input');
              const d = decs.find((dd) => decoratorCallName(dd, sf) === 'Input');
              const alias = d ? decoratorArgString0(d) : undefined;
              if (alias) setAttrTag(attr, 'angular.inputAlias', alias);
            }

            if (names.includes('Output')) {
              setAttrTag(attr, 'angular.role', 'output');
              const d = decs.find((dd) => decoratorCallName(dd, sf) === 'Output');
              const alias = d ? decoratorArgString0(d) : undefined;
              if (alias) setAttrTag(attr, 'angular.outputAlias', alias);

              const payload = extractEventEmitterPayloadName(m);
              if (payload) {
                setAttrTag(attr, 'angular.outputPayloadType', payload);
                if (includeDeps) {
                  const payloadSimple = payload.includes('.') ? payload.split('.').pop()! : payload;
                  const to = classifierByName.get(payloadSimple);
                  if (to) {
                    addRelation(sf, 'DEPENDENCY', c.id, to.id, m, [
                      { key: 'origin', value: 'output' },
                      { key: 'role', value: 'eventPayload' },
                      { key: 'member', value: propName },
                    ]);
                  } else if (report) {
                    addFinding(report, {
                      kind: 'unresolvedType',
                      severity: 'warning',
                      message: `@Output payload type '${payload}' on ${c.name}.${propName} was not found as a classifier`,
                      location: { file: rel },
                      tags: { owner: c.name, member: propName, type: payload, origin: 'output' },
                    });
                  }
                }
              }
            }
          };

          for (const m of node.members) handleInputOutput(m);
        }

        // DI edges for Component/Injectable
        if (isComponent || isInjectable) {
          const ctor = node.members.find((m) => ts.isConstructorDeclaration(m)) as ts.ConstructorDeclaration | undefined;
          if (ctor) {
            for (const p of ctor.parameters) {
              const tn = getTypeNameFromParam(p);
              if (!tn) continue;
              const to = classifierByName.get(tn);
              if (to) addRelation(sf, 'DI', c.id, to.id, p, [{ key: 'origin', value: 'constructor' }]);
              else if (report) {
                addFinding(report, {
                  kind: 'unresolvedType',
                  severity: 'warning',
                  message: `Constructor DI parameter type '${tn}' on ${c.name} was not found as a classifier`,
                  location: { file: rel },
                  tags: { owner: c.name, type: tn, origin: 'constructor' },
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);

    // Step 12: Angular routing extraction
    // Best-effort parse of RouterModule.forRoot/forChild route arrays (and exported routes constants).
    const routeClassifiersByKey = new Map<string, IrClassifier>();

    const ensureRouteClassifier = (key: string, routeName: string, routePath: string, lazy: boolean, sourceNode: ts.Node) => {
      if (routeClassifiersByKey.has(key)) return routeClassifiersByKey.get(key)!;
      const id = hashId('c:', `angular-route:${rel}:${key}:${sourceNode.pos}`);
      const c: IrClassifier = {
        id,
        kind: 'MODULE',
        name: routeName,
        qualifiedName: `${rel}#route:${routePath}`,
        stereotypes: [{ name: 'AngularRoute' }],
        taggedValues: [
          { key: 'framework', value: 'angular' },
          { key: 'angular.routePath', value: routePath },
          { key: 'angular.routeLazy', value: lazy ? 'true' : 'false' },
        ],
        source: sourceRefForNode(sf, sourceNode, projectRoot),
      };
      model.classifiers.push(c);
      routeClassifiersByKey.set(key, c);
      return c;
    };

    const resolveLocalArrayInitializer = (ident: ts.Identifier): ts.ArrayLiteralExpression | undefined => {
      // Only resolve within the same source file.
      const sym = checker.getSymbolAtLocation(ident);
      const decl = sym?.valueDeclaration;
      if (!decl) return undefined;
      if (ts.isVariableDeclaration(decl) && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        return decl.initializer;
      }
      return undefined;
    };

    const getObjectProp = (obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
        if (pn !== name) continue;
        return p.initializer;
      }
      return undefined;
    };

    const readString = (e: ts.Expression | undefined): string | undefined => {
      if (!e) return undefined;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
      return undefined;
    };

    const readIdentifierName = (e: ts.Expression | undefined): string | undefined => {
      if (!e) return undefined;
      if (ts.isIdentifier(e)) return e.text;
      if (ts.isPropertyAccessExpression(e)) return e.name.text;
      return undefined;
    };

    const parseLazyModuleName = (e: ts.Expression | undefined): { moduleName?: string; specifier?: string } => {
      // Handles: () => import('./x').then(m => m.FooModule)
      if (!e) return {};
      if (!ts.isArrowFunction(e) && !ts.isFunctionExpression(e)) return {};
      const body = e.body;
      const expr = ts.isBlock(body)
        ? body.statements.find((s) => ts.isReturnStatement(s)) && (body.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement).expression
        : body;
      if (!expr || !ts.isCallExpression(expr)) return {};
      // expr should be: import('...').then(...)
      if (!ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== 'then') return {};
      const importCall = expr.expression.expression;
      let specifier: string | undefined;
      if (ts.isCallExpression(importCall) && importCall.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = readString(importCall.arguments[0]);
      }
      const thenArg = expr.arguments[0];
      if (!thenArg) return { specifier };
      if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
        const thenBody = thenArg.body;
        const thenExpr = ts.isBlock(thenBody)
          ? thenBody.statements.find((s) => ts.isReturnStatement(s)) && (thenBody.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement).expression
          : thenBody;
        if (thenExpr && ts.isPropertyAccessExpression(thenExpr)) {
          return { moduleName: thenExpr.name.text, specifier };
        }
      }
      return { specifier };
    };

    const addRouterEdge = (route: IrClassifier, role: 'component' | 'loadChildren', targetName: string, node: ts.Node, extraTags: Record<string, string> = {}) => {
      const to = classifierByName.get(targetName);
      if (to) {
        addRelation(sf, 'DEPENDENCY', route.id, to.id, node, [
          { key: 'origin', value: 'router' },
          { key: 'role', value: role },
          ...Object.entries(extraTags).map(([key, value]) => ({ key, value })),
        ]);
      } else if (report) {
        addFinding(report, {
          kind: role === 'component' ? 'unresolvedRouteTarget' : 'unresolvedLazyModule',
          severity: 'warning',
          message:
            role === 'component'
              ? `Route target component '${targetName}' was not found as a classifier`
              : `Lazy route module '${targetName}' was not found as a classifier`,
          location: { file: rel },
          tags: { role, target: targetName, ...extraTags },
        });
      }
    };

    const parseRoutesArray = (arr: ts.ArrayLiteralExpression, originNode: ts.Node) => {
      let idx = 0;
      for (const el of arr.elements) {
        if (!ts.isObjectLiteralExpression(el)) {
          idx++;
          continue;
        }
        const pathVal = readString(getObjectProp(el, 'path')) ?? '';
        const compName = readIdentifierName(getObjectProp(el, 'component'));
        const lazyInfo = parseLazyModuleName(getObjectProp(el, 'loadChildren'));
        const lazyName = lazyInfo.moduleName;
        const lazy = !!lazyName;

        const target = compName ?? lazyName ?? '(unknown)';
        const key = `${pathVal}::${target}::${idx}`;
        const routeName = `route:${pathVal || '(root)'} -> ${target}`;
        const routeC = ensureRouteClassifier(key, routeName, pathVal, lazy, el);

        if (compName) {
          addRouterEdge(routeC, 'component', compName, el);
        }
        if (lazyName) {
          const extra: Record<string, string> = {};
          if (lazyInfo.specifier) extra.specifier = lazyInfo.specifier;
          addRouterEdge(routeC, 'loadChildren', lazyName, el, extra);
        }
        idx++;
      }
    };

    const routeVisit = (node: ts.Node) => {
      // RouterModule.forRoot([...]) / forChild([...])
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (name === 'forRoot' || name === 'forChild') {
          const lhs = node.expression.expression;
          const lhsName = ts.isIdentifier(lhs) ? lhs.text : ts.isPropertyAccessExpression(lhs) ? lhs.name.text : undefined;
          if (lhsName === 'RouterModule') {
            const a0 = node.arguments[0];
            let arr: ts.ArrayLiteralExpression | undefined;
            if (a0 && ts.isArrayLiteralExpression(a0)) arr = a0;
            else if (a0 && ts.isIdentifier(a0)) arr = resolveLocalArrayInitializer(a0);
            if (arr) parseRoutesArray(arr, node);
          }
        }
      }

      // export const routes: Routes = [...]
      if (ts.isVariableStatement(node)) {
        const isExport = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExport) {
          for (const d of node.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isArrayLiteralExpression(d.initializer)) continue;
            const varName = d.name.text;
            const typeText = d.type ? d.type.getText(sf) : '';
            if (varName.toLowerCase().includes('route') || typeText.includes('Routes')) {
              parseRoutesArray(d.initializer, d);
            }
          }
        }
      }

      ts.forEachChild(node, routeVisit);
    };

    routeVisit(sf);
  }
}