import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import type { AddRelationFn } from './modules';
import { buildNgRxIndex, extractAngularStateEdges, addNgRxEffectOfTypeEdges } from '../stateNgRx';

export type NgRxIndex = ReturnType<typeof buildNgRxIndex>;

export function createNgRxIndex(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: ExtractorContext['model'];
  report: ExtractorContext['report'];
}): NgRxIndex {
  const { program, projectRoot, scannedRel, model, report } = args;
  const ngrxIndex = buildNgRxIndex({ program, projectRoot, scannedRel, model });
  addNgRxEffectOfTypeEdges({ program, projectRoot, scannedRel, model, ngrx: ngrxIndex, report });
  return ngrxIndex;
}

export function enrichAngularState(args: {
  sf: ts.SourceFile;
  relPath: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  addRelation: AddRelationFn;
  ngrx: NgRxIndex;
  report: ExtractorContext['report'];
}) {
  const { sf, relPath, projectRoot, node, c, addRelation, ngrx, report } = args;

  extractAngularStateEdges({
    sf,
    rel: relPath,
    projectRoot,
    node,
    c,
    addRelation,
    ngrx,
    report,
  });
}
