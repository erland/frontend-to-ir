import ts from 'typescript';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../../ir/irV1';
import { hashId } from '../../../../util/id';
import { sourceRefForNode } from '../util';
import { addFinding } from '../../../../report/reportBuilder';
import type { ExtractionReport } from '../../../../report/extractionReport';
import type { AddAngularRelation } from '../routing';
import type { NgRxConceptDecl, NgRxConceptKind, NgRxDispatchFinding, NgRxSelectFinding, NgRxInlineOfTypeFinding, NgRxOfTypeFinding } from './detect';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

export type NgRxMaps = {
  actionsByIdent: Map<string, IrClassifier>;
  selectorsByIdent: Map<string, IrClassifier>;
  effectsByIdent: Map<string, IrClassifier>;
};

function stereotypeForKind(kind: NgRxConceptKind): string {
  if (kind === 'action') return 'NgRxAction';
  if (kind === 'selector') return 'NgRxSelector';
  return 'NgRxEffect';
}

function ensureConcept(args: {
  model: { classifiers: IrClassifier[] };
  sf: ts.SourceFile;
  projectRoot: string;
  node: ts.Node;
  kind: NgRxConceptKind;
  ident: string;
  qualifiedKey: string;
}): IrClassifier {
  const { model, sf, projectRoot, node, kind, ident, qualifiedKey } = args;
  const id = hashId('c:', qualifiedKey);
  const existing = model.classifiers.find((c) => c.id === id);
  if (existing) return existing;

  const c: IrClassifier = {
    id,
    kind: 'MODULE',
    name: ident,
    qualifiedName: qualifiedKey,
    stereotypes: [{ name: stereotypeForKind(kind) }],
    taggedValues: [tag('framework', 'angular'), tag('origin', 'state')],
    source: sourceRefForNode(sf, node, projectRoot),
  };
  model.classifiers.push(c);
  return c;
}

/** Emit concepts into model and return NgRx maps keyed by identifier name. */
export function emitNgRxConceptIndex(args: {
  conceptDecls: NgRxConceptDecl[];
  projectRoot: string;
  model: { classifiers: IrClassifier[] };
}): NgRxMaps {
  const { conceptDecls, projectRoot, model } = args;
  const maps: NgRxMaps = { actionsByIdent: new Map(), selectorsByIdent: new Map(), effectsByIdent: new Map() };

  for (const d of conceptDecls) {
    const c = ensureConcept({
      model,
      sf: d.sf,
      projectRoot,
      node: d.node,
      kind: d.kind,
      ident: d.ident,
      qualifiedKey: d.qualifiedKey,
    });
    if (d.kind === 'action') maps.actionsByIdent.set(d.ident, c);
    else if (d.kind === 'selector') maps.selectorsByIdent.set(d.ident, c);
    else maps.effectsByIdent.set(d.ident, c);
  }

  return maps;
}

/** Emit effect->action edges for ofType() calls discovered inside createEffect initializers (global scan). */
export function emitNgRxEffectOfTypeEdges(args: {
  projectRoot: string;
  model: { relations?: any[] };
  ngrx: NgRxMaps;
  findings: NgRxOfTypeFinding[];
  report?: ExtractionReport;
}) {
  const { projectRoot, model, ngrx, findings, report } = args;
  model.relations = model.relations ?? [];

  const relId = (sf: ts.SourceFile, fromId: string, toId: string, role: string, pos: number) =>
    hashId('r:', `STATE:ngrx:${sf.fileName}:${fromId}->${toId}:${role}:${pos}`);

  for (const f of findings) {
    const eff = ngrx.effectsByIdent.get(f.effectIdent);
    if (!eff) continue;
    const action = ngrx.actionsByIdent.get(f.actionIdent);
    if (action) {
      const id = relId(f.sf, eff.id, action.id, 'ofType', f.pos);
      if (!model.relations!.some((r: any) => r.id === id)) {
        model.relations!.push({
          id,
          kind: 'DEPENDENCY',
          sourceId: eff.id,
          targetId: action.id,
          taggedValues: [
            tag('origin', 'state'),
            tag('role', 'ofType'),
            tag('state.kind', 'ngrx'),
            tag('state.effect', f.effectIdent),
            tag('state.action', f.actionIdent),
          ],
          stereotypes: [],
          source: sourceRefForNode(f.sf, f.node, projectRoot),
        });
      }
    } else if (report) {
      addFinding(report, {
        kind: 'note',
        severity: 'info',
        message: `NgRx ofType action not indexed: ${f.actionIdent}`,
        location: { file: sourceRefForNode(f.sf, f.node, projectRoot).file },
      });
    }
  }
}

/** Emit class->action/selector and inline effect->action edges found inside a class. */
export function emitNgRxEdgesInClass(args: {
  projectRoot: string;
  addRelation: AddAngularRelation;
  ngrx: NgRxMaps;
  dispatches: NgRxDispatchFinding[];
  selects: NgRxSelectFinding[];
  inlineOfType: NgRxInlineOfTypeFinding[];
  report?: ExtractionReport;
}) {
  const { projectRoot, addRelation, ngrx, dispatches, selects, inlineOfType, report } = args;

  for (const d of dispatches) {
    const target = ngrx.actionsByIdent.get(d.actionIdent);
    if (target) {
      addRelation(d.sf, 'DEPENDENCY' as IrRelationKind, d.classId, target.id, d.node, [
        tag('origin', 'state'),
        tag('role', 'dispatches'),
        tag('state.kind', 'ngrx'),
        tag('state.action', d.actionIdent),
      ]);
    } else if (report) {
      addFinding(report, {
        kind: 'note',
        severity: 'info',
        message: `NgRx dispatch action not indexed: ${d.actionIdent}`,
        location: { file: sourceRefForNode(d.sf, d.node, projectRoot).file },
      });
    }
  }

  for (const s of selects) {
    const target = ngrx.selectorsByIdent.get(s.selectorIdent);
    if (target) {
      addRelation(s.sf, 'DEPENDENCY' as IrRelationKind, s.classId, target.id, s.node, [
        tag('origin', 'state'),
        tag('role', 'selects'),
        tag('state.kind', 'ngrx'),
        tag('state.selector', s.selectorIdent),
      ]);
    }
  }

  for (const o of inlineOfType) {
    const eff = ngrx.effectsByIdent.get(o.effectIdent);
    if (!eff) continue;
    const action = ngrx.actionsByIdent.get(o.actionIdent);
    if (!action) continue;
    addRelation(o.sf, 'DEPENDENCY' as IrRelationKind, eff.id, action.id, o.node, [
      tag('origin', 'state'),
      tag('role', 'ofType'),
      tag('state.kind', 'ngrx'),
      tag('state.effect', o.effectIdent),
      tag('state.action', o.actionIdent),
    ]);
  }
}
