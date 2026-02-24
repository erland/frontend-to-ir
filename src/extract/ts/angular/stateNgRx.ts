import ts from 'typescript';
import type { IrClassifier } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import type { AddAngularRelation } from './routing';

import { detectNgRxConceptDeclsInSourceFile, detectNgRxEdgesInClass, detectNgRxOfTypeInCreateEffects } from './ngrx/detect';
import { emitNgRxConceptIndex, emitNgRxEdgesInClass, emitNgRxEffectOfTypeEdges, type NgRxMaps } from './ngrx/emit';

/**
 * Backwards-compatible façade:
 * - buildNgRxIndex: detects + emits concept classifiers and returns the identifier maps.
 * - addNgRxEffectOfTypeEdges: detects ofType(ActionX) inside createEffect initializers and emits effect->action relations.
 * - extractAngularStateEdges: detects dispatch/select/ofType usage within a class and emits relations via addRelation.
 */

export { type NgRxMaps };

export function buildNgRxIndex(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: { classifiers: IrClassifier[]; packages?: any[] };
}): NgRxMaps {
  const { program, projectRoot, scannedRel, model } = args;

  const conceptDecls = [];
  for (const rel of scannedRel) {
    const abs = ts.sys.resolvePath(`${projectRoot}/${rel}`);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;
    conceptDecls.push(...detectNgRxConceptDeclsInSourceFile({ sf }));
  }

  return emitNgRxConceptIndex({ conceptDecls, projectRoot, model });
}

export function addNgRxEffectOfTypeEdges(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: { relations?: any[] };
  ngrx: NgRxMaps;
  report?: ExtractionReport;
}) {
  const { program, projectRoot, scannedRel, model, ngrx, report } = args;

  const findings = [];
  for (const rel of scannedRel) {
    const abs = ts.sys.resolvePath(`${projectRoot}/${rel}`);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;
    findings.push(...detectNgRxOfTypeInCreateEffects({ sf }));
  }

  emitNgRxEffectOfTypeEdges({ projectRoot, model, ngrx, findings, report });
}

export function extractAngularStateEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  addRelation: AddAngularRelation;
  ngrx: NgRxMaps;
  report?: ExtractionReport;
}) {
  const { sf, projectRoot, node, c, addRelation, ngrx, report } = args;

  const detected = detectNgRxEdgesInClass({ sf, node, classId: c.id });

  emitNgRxEdgesInClass({
    projectRoot,
    addRelation,
    ngrx,
    dispatches: detected.dispatches,
    selects: detected.selects,
    inlineOfType: detected.inlineOfType,
    report,
  });
}
