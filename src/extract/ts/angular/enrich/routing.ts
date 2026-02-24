import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';
import type { ExtractorContext } from '../../context';
import type { AddRelationFn } from './modules';
import { extractAngularRoutesFromSourceFile } from '../routing';

export function enrichAngularRoutingFile(args: {
  sf: ts.SourceFile;
  relPath: string;
  projectRoot: string;
  model: ExtractorContext['model'];
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddRelationFn;
  report: ExtractorContext['report'];
  addStereo: (c: IrClassifier, name: string) => void;
  setTag: (c: IrClassifier, key: string, value: string) => void;
}) {
  const { sf, relPath, projectRoot, model, checker, classifierByName, addRelation, report, addStereo, setTag } = args;

  extractAngularRoutesFromSourceFile({
    sf,
    rel: relPath,
    projectRoot,
    model,
    checker,
    classifierByName,
    addRelation,
    report,
    markTarget: (target, stereo, tags) => {
      addStereo(target, stereo);
      if (tags) {
        for (const [k, v] of Object.entries(tags)) setTag(target, `angular.${k}`, v);
      }
    },
  });
}
