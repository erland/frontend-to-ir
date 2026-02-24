import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import type { AddRelationFn } from './modules';
import { buildAngularTemplateIndex, extractAngularTemplateEdges } from '../templates';

export type TemplateIndex = ReturnType<typeof buildAngularTemplateIndex>;

export function createTemplateIndex(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: ExtractorContext['model'];
}): TemplateIndex {
  const { program, projectRoot, scannedRel, model } = args;
  return buildAngularTemplateIndex({ program, projectRoot, scannedRel, model });
}

export function enrichAngularTemplates(args: {
  sf: ts.SourceFile;
  relPath: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  program: ts.Program;
  model: ExtractorContext['model'];
  addRelation: AddRelationFn;
  index: TemplateIndex;
  report: ExtractorContext['report'];
}) {
  const { sf, relPath, projectRoot, node, c, program, model, addRelation, index, report } = args;

  extractAngularTemplateEdges({
    sf,
    rel: relPath,
    projectRoot,
    node,
    c,
    program,
    model,
    addRelation,
    index,
    report,
  });
}
