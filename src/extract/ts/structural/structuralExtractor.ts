import ts from 'typescript';
import {
  createEmptyIrModel,
  IrClassifier,
  IrModel,
  IrRelation,
} from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import type { EnsureFileModuleFn, IrPackageInfo } from '../context';
import { buildPackageMap } from './packageMap';
import { createEnsureFileModule, declareClassifiersInProgram, type DeclaredSymbol } from './declareClassifiers';
import { createRelationAdder } from './extractRelations';
import { fillMembersAndRelations } from './extractMembers';

export type StructuralExtractOptions = {
  importGraph?: boolean;
  includeDeps?: boolean;
  report?: ExtractionReport;
};

export type StructuralExtractResult = {
  model: IrModel;
  pkgByDir: Map<string, IrPackageInfo>;
  ensureFileModule: EnsureFileModuleFn;
};

export function extractStructuralModel(ctx: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  scannedAbs: string[];
  checker: ts.TypeChecker;
  options: StructuralExtractOptions;
}): StructuralExtractResult {
  const { program, projectRoot, scannedRel, scannedAbs, checker } = ctx;
  const opts = ctx.options;

  const model = createEmptyIrModel();

  // Packages
  const pkgByDir = buildPackageMap(scannedAbs, projectRoot);
  model.packages = Array.from(pkgByDir.values()).map((p) => ({
    id: p.id,
    name: p.name,
    qualifiedName: p.qualifiedName,
    parentId: p.parentId,
  }));

  // Classifiers + symbol map
  const declared = new Map<ts.Symbol, DeclaredSymbol>();
  const classifierById = new Map<string, IrClassifier>();

  // Optional module classifier per file, used for import graph extraction.
  const moduleByRelFile = new Map<string, IrClassifier>();
  const ensureFileModule = createEnsureFileModule({ classifierById, moduleByRelFile });

  // First pass: declarations
  declareClassifiersInProgram({
    program,
    projectRoot,
    scannedRel,
    pkgByDir,
    checker,
    importGraph: Boolean(opts.importGraph),
    report: opts.report,
    declared,
    classifierById,
    ensureFileModule,
  });

  // Second pass: members + base relations
  const relations: IrRelation[] = [];
  const addRelation = createRelationAdder({
    projectRoot,
    includeDeps: opts.includeDeps,
    report: opts.report,
    relations,
  });

  fillMembersAndRelations({
    program,
    projectRoot,
    scannedRel,
    pkgByDir,
    checker,
    declared,
    classifierById,
    relations,
    includeDeps: opts.includeDeps,
    addRelation,
  });

  model.classifiers = Array.from(classifierById.values());
  model.relations = relations;

  return { model, pkgByDir, ensureFileModule };
}
