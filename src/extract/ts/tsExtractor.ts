import path from 'node:path';
import { scanSourceFiles } from '../../scan/sourceScanner';
import { enrichReactModel } from './react/reactEnricher';
import { enrichAngularModel } from './angular/angularEnricher';
import { canonicalizeIrModel } from '../../ir/canonicalizeIrModel';
import { buildStereotypeRegistryFromLegacy } from '../../ir/stereotypes/buildStereotypeRegistry';
import type { ExtractionReport } from '../../report/extractionReport';
import { extractImportGraphRelations } from './imports/importGraph';
import { extractStructuralModel } from './structural/structuralExtractor';
import { extractPublicApiSurface } from './exports/publicApi';
import { createProgramFromScan } from './program/createProgram';
import type { ExtractorContext } from './context';
import { postProcessReportFromModel } from './report/postProcessReport';

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

  const ctx: ExtractorContext = {
    program,
    checker,
    projectRoot,
    scannedRel,
    model,
    pkgByDir,
    ensureFileModule,
    report: opts.report,
    includeDeps: opts.includeDeps,
    includeFrameworkEdges: opts.includeFrameworkEdges,
  };

  if (opts.react) enrichReactModel(ctx);
  if (opts.angular) enrichAngularModel(ctx);

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

  if (opts.importGraph) {
    const pa = extractPublicApiSurface({
      program,
      checker,
      compilerOptions,
      projectRoot,
      scannedRel,
      model,
      pkgByDir,
      ensureFileModule: (relFile: string, pkgId: string) => ensureFileModule(relFile, pkgId),
      report: opts.report,
    });
    model.relations = [...(model.relations ?? []), ...pa.relations];
  }


  // Step 3: Build IR v2 stereotype registry + refs from existing legacy stereotypes.
  const withStereotypes = buildStereotypeRegistryFromLegacy(model);

  // Step 8: populate report counts + unresolved tracking.
  if (opts.report) postProcessReportFromModel(withStereotypes, opts.report);

  return canonicalizeIrModel(withStereotypes);
}
