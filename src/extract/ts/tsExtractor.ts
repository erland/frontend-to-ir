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
import { enrichReactModel } from './react/reactEnricher';
import { enrichAngularModel } from './angular/angularEnricher';
import { canonicalizeIrModel } from '../../ir/canonicalizeIrModel';
import type { ExtractionReport } from '../../report/extractionReport';
import { addFinding, incCount } from '../../report/reportBuilder';
import { extractImportGraphRelations } from './imports/importGraph';

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
