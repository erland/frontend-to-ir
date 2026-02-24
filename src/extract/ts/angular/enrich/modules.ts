import ts from 'typescript';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import { extractNgModuleEdges } from '../ngModule';
import { extractStandaloneComponentEdges } from '../modules';
import { extractInputsOutputs } from '../inputsOutputs';
import { extractProviderRegistrationEdges } from '../di';

export type AddRelationFn = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

export function enrichAngularNgModule(args: {
  sf: ts.SourceFile;
  node: ts.ClassDeclaration;
  relPath: string;
  c: IrClassifier;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddRelationFn;
  report: ExtractorContext['report'];
}) {
  const { sf, node, relPath, c, classifierByName, addRelation, report } = args;

  extractNgModuleEdges({
    sf,
    node,
    relPath,
    c,
    classifierByName,
    addRelation,
    report,
  });

  extractProviderRegistrationEdges({
    sf,
    rel: relPath,
    node,
    c,
    classifierByName,
    addRelation,
    report,
  });
}

export function enrichAngularComponentModuleEdges(args: {
  sf: ts.SourceFile;
  node: ts.ClassDeclaration;
  relPath: string;
  projectRoot: string;
  c: IrClassifier;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  includeDeps: boolean | undefined;
  addRelation: AddRelationFn;
  report: ExtractorContext['report'];
}) {
  const { sf, node, relPath, projectRoot, c, checker, classifierByName, includeDeps, addRelation, report } = args;

  extractInputsOutputs({
    sf,
    node,
    rel: relPath,
    projectRoot,
    c,
    checker,
    classifierByName,
    includeDeps,
    addRelation,
    report,
  });

  extractProviderRegistrationEdges({
    sf,
    rel: relPath,
    node,
    c,
    classifierByName,
    addRelation,
    report,
  });

  extractStandaloneComponentEdges({
    sf,
    node,
    relPath,
    c,
    classifierByName,
    addRelation,
    report,
  });
}
