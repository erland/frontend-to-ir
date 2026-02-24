import ts from 'typescript';

import type { IrClassifier, IrRelation } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import type { EnsureFileModuleFn, IrPackageInfo } from '../context';

import { discoverPublicApiEntrypoints } from './publicApi/discoverEntrypoints';
import { walkPublicApiExportGraph } from './publicApi/walkExportGraph';
import { emitPublicApiSurface } from './publicApi/emitSurface';

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

  const { scannedRel: entryRel } = discoverPublicApiEntrypoints({ scannedRel });
  const { exportByFileAndName } = walkPublicApiExportGraph({ program, projectRoot, scannedRel: entryRel, model, pkgByDir });
  return emitPublicApiSurface({
    program,
    checker,
    compilerOptions,
    projectRoot,
    scannedRel: entryRel,
    exportByFileAndName,
    pkgByDir,
    ensureFileModule,
    report,
  });
}
