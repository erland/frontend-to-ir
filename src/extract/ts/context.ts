import ts from 'typescript';
import type { IrModel, IrClassifier } from '../../ir/irV1';
import type { ExtractionReport } from '../../report/extractionReport';

export type IrPackageInfo = {
  id: string;
  name: string;
  qualifiedName: string;
  parentId?: string;
};

export type EnsureFileModuleFn = (relFile: string, pkgId: string) => IrClassifier;

export type ExtractorContext = {
  projectRoot: string;
  scannedRel: string[];
  program: ts.Program;
  checker: ts.TypeChecker;
  model: IrModel;
  /** Optional report collector for findings & counts. */
  report?: ExtractionReport;

  includeDeps?: boolean;
  includeFrameworkEdges?: boolean;

  /** Package lookup and file-module helper shared across passes. */
  pkgByDir: Map<string, IrPackageInfo>;
  ensureFileModule: EnsureFileModuleFn;
};
