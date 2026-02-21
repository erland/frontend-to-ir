import type { ExtractorContext } from '../context';
import type { IrClassifier } from '../../../ir/irV1';
import { addStereotype, hasStereotype, isPascalCase, setClassifierTag, sourceRefForNode } from './util';
import type { ReactWorkContext } from './types';
import { detectReactComponents } from './components';
import { detectReactContexts, addUseContextAndProviderEdges } from './context';
import { addJsxRenderEdges } from './renderEdges';

export function enrichReactModel(ctx: ExtractorContext) {
  const { program, checker, projectRoot, scannedRel, model, report, includeFrameworkEdges } = ctx;

  const classifierByFileAndName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) {
    const file = c.source?.file;
    if (!file) continue;
    classifierByFileAndName.set(`${file}::${c.name}`, c);
  }

  const rctx: ReactWorkContext = {
    program,
    checker,
    projectRoot,
    scannedRel,
    model,
    report,
    includeFrameworkEdges,
    classifierByFileAndName,
    isPascalCase,
    sourceRefForNode: (sf, node) => sourceRefForNode(sf, node, projectRoot),
    hasStereotype,
    addStereotype,
    setClassifierTag,
  };

  // 1) Create/ensure React Context classifiers
  detectReactContexts(rctx);

  // 2) Detect component classifiers (and props/state)
  const { ownerByNode } = detectReactComponents(rctx);

  // 3) Add JSX RENDER edges
  addJsxRenderEdges(rctx, ownerByNode);

  // 4) Add useContext/provider DI edges
  addUseContextAndProviderEdges(rctx, ownerByNode);
}
