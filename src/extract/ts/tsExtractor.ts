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
import { extractStructuralModel } from './structural/structuralExtractor';
import { createProgramFromScan } from './program/createProgram';

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


const { program, checker, compilerOptions } = createProgramFromScan({
  projectRoot,
  rootNamesAbs: scannedAbs,
  tsconfigPath: opts.tsconfigPath,
  forceAllowJs: opts.forceAllowJs,
});


  if (opts.report) {
    // program.getSourceFiles includes lib files; count only our scanned set.
    opts.report.filesProcessed = scannedRel.length;
  }
  const { model, pkgByDir, ensureFileModule } = extractStructuralModel({
    program,
    checker,
    projectRoot,
    scannedRel,
    scannedAbs,
    options: {
      importGraph: opts.importGraph,
      includeDeps: opts.includeDeps,
      report: opts.report,
    },
  });

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
