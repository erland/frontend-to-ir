import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import type { AddRelationFn } from './modules';
import { extractAngularHttpEdges } from '../http';

export function enrichAngularHttp(args: {
  sf: ts.SourceFile;
  relPath: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  checker: ts.TypeChecker;
  model: ExtractorContext['model'];
  addRelation: AddRelationFn;
  report: ExtractorContext['report'];
}) {
  const { sf, relPath, projectRoot, node, c, checker, model, addRelation, report } = args;

  extractAngularHttpEdges({
    sf,
    rel: relPath,
    projectRoot,
    node,
    c,
    checker,
    model,
    addRelation,
    report,
  });
}
