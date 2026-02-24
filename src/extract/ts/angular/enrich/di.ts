import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import type { AddRelationFn } from './modules';
import { extractConstructorDiEdges, extractInjectFunctionEdges } from '../di';

export function enrichAngularDi(args: {
  sf: ts.SourceFile;
  relPath: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddRelationFn;
  report: ExtractorContext['report'];
}) {
  const { sf, relPath, node, c, checker, classifierByName, addRelation, report } = args;

  extractConstructorDiEdges({
    sf,
    rel: relPath,
    node,
    c,
    checker,
    classifierByName,
    addRelation,
    report,
  });

  extractInjectFunctionEdges({
    sf,
    rel: relPath,
    node,
    c,
    classifierByName,
    addRelation,
    report,
  });
}

export function postProcessAngularInterceptors(args: {
  model: ExtractorContext['model'];
  addStereo: (c: IrClassifier, name: string) => void;
  setTag: (c: IrClassifier, key: string, value: string) => void;
}) {
  const { model, addStereo, setTag } = args;

  // Post-pass: mark HTTP interceptors based on DI provider registrations.
  for (const r of model.relations ?? []) {
    if (r.kind !== 'DI') continue;
    const tv = (k: string) => (r.taggedValues ?? []).find((t) => t.key === k)?.value;
    const provide = tv('provide') ?? tv('token') ?? '';
    if (provide !== 'HTTP_INTERCEPTORS') continue;
    const target = model.classifiers.find((c) => c.id === r.targetId);
    if (!target) continue;
    addStereo(target, 'AngularInterceptor');
    setTag(target, 'angular.interceptor', 'true');
  }
}
