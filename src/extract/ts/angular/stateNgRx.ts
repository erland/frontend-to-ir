import ts from 'typescript';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../ir/irV1';
import { hashId } from '../../../util/id';
import { safeNodeText } from '../util/safeText';
import { sourceRefForNode } from './util';
import { addFinding } from '../../../report/reportBuilder';
import type { ExtractionReport } from '../../../report/extractionReport';
import type { AddAngularRelation } from './routing';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function upper(s: string): string {
  return s.toUpperCase();
}

type NgRxMaps = {
  actionsByIdent: Map<string, IrClassifier>;
  selectorsByIdent: Map<string, IrClassifier>;
  effectsByIdent: Map<string, IrClassifier>;
};

function ensureConcept(args: {
  model: { classifiers: IrClassifier[] };
  sf: ts.SourceFile;
  projectRoot: string;
  node: ts.Node;
  stereotype: string;
  name: string;
  qualifiedKey: string;
  framework: 'angular';
}): IrClassifier {
  const { model, sf, projectRoot, node, stereotype, name, qualifiedKey } = args;
  const id = hashId('c:', qualifiedKey);
  const existing = model.classifiers.find((c) => c.id === id);
  if (existing) return existing;

  const c: IrClassifier = {
    id,
    kind: 'MODULE',
    name,
    qualifiedName: qualifiedKey,
    stereotypes: [{ name: stereotype }],
    taggedValues: [tag('framework', 'angular'), tag('origin', 'state')],
    source: sourceRefForNode(sf, node, projectRoot),
  };
  model.classifiers.push(c);
  return c;
}

function varNameForInit(node: ts.Node): string | undefined {
  // const X = <init>
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function isCallNamed(call: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(call.expression) && call.expression.text === name;
}

function collectFromSourceFile(args: {
  sf: ts.SourceFile;
  projectRoot: string;
  model: { classifiers: IrClassifier[] };
  maps: NgRxMaps;
}) {
  const { sf, projectRoot, model, maps } = args;

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (isCallNamed(n, 'createAction')) {
        const name = varNameForInit(n);
        if (name) {
          const key = `state:ngrx:action:${sf.fileName}:${name}`;
          const c = ensureConcept({
            model,
            sf,
            projectRoot,
            node: n,
            stereotype: 'NgRxAction',
            name,
            qualifiedKey: key,
            framework: 'angular',
          });
          maps.actionsByIdent.set(name, c);
        }
      } else if (isCallNamed(n, 'createSelector')) {
        const name = varNameForInit(n);
        if (name) {
          const key = `state:ngrx:selector:${sf.fileName}:${name}`;
          const c = ensureConcept({
            model,
            sf,
            projectRoot,
            node: n,
            stereotype: 'NgRxSelector',
            name,
            qualifiedKey: key,
            framework: 'angular',
          });
          maps.selectorsByIdent.set(name, c);
        }
      } else if (isCallNamed(n, 'createEffect')) {
        const name = varNameForInit(n);
        if (name) {
          const key = `state:ngrx:effect:${sf.fileName}:${name}`;
          const c = ensureConcept({
            model,
            sf,
            projectRoot,
            node: n,
            stereotype: 'NgRxEffect',
            name,
            qualifiedKey: key,
            framework: 'angular',
          });
          maps.effectsByIdent.set(name, c);
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  visit(sf);
}

export function buildNgRxIndex(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: { classifiers: IrClassifier[] };
}): NgRxMaps {
  const { program, projectRoot, scannedRel, model } = args;

  const maps: NgRxMaps = {
    actionsByIdent: new Map(),
    selectorsByIdent: new Map(),
    effectsByIdent: new Map(),
  };

  for (const rel of scannedRel) {
    const abs = ts.sys.resolvePath(`${projectRoot}/${rel}`);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;
    collectFromSourceFile({ sf, projectRoot, model, maps });
  }

  return maps;
}

function isThisDotStore(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === 'store'
  );
}

function isIdent(expr: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expr) && expr.text === name;
}

function getIdentFromExpr(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
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
  model.relations = model.relations ?? [];

  const relId = (sf: ts.SourceFile, fromId: string, toId: string, role: string, pos: number) =>
    hashId('r:', `STATE:ngrx:${sf.fileName}:${fromId}->${toId}:${role}:${pos}`);

  const visitEffect = (sf: ts.SourceFile, call: ts.CallExpression) => {
    const effectName = varNameForInit(call);
    if (!effectName) return;
    const eff = ngrx.effectsByIdent.get(effectName);
    if (!eff) return;

    const scan = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'ofType') {
        for (const a of n.arguments) {
          const aName =
            getIdentFromExpr(a) ?? (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.name) ? a.name.text : undefined);
          if (!aName) continue;
          const action = ngrx.actionsByIdent.get(aName);
          if (action) {
            const id = relId(sf, eff.id, action.id, 'ofType', n.pos);
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
                  tag('state.effect', effectName),
                  tag('state.action', aName),
                ],
                stereotypes: [],
                source: sourceRefForNode(sf, n, projectRoot),
              });
            }
          } else if (report) {
            addFinding(report, {
              kind: 'note',
              severity: 'info',
              message: `NgRx ofType action not indexed: ${aName}`,
              location: { file: sourceRefForNode(sf, n, projectRoot).file },
            });
          }
        }
      }
      ts.forEachChild(n, scan);
    };

    // scan inside the createEffect initializer argument(s)
    for (const a of call.arguments) scan(a);
  };

  for (const rel of scannedRel) {
    const abs = ts.sys.resolvePath(`${projectRoot}/${rel}`);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && isCallNamed(n, 'createEffect')) {
        visitEffect(sf, n);
      }
      ts.forEachChild(n, visit);
    };

    visit(sf);
  }
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

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.name)) {
      const method = n.expression.name.text;

      // this.store.dispatch(actionCreator(...))
      if (method === 'dispatch' && (isThisDotStore(n.expression.expression) || isIdent(n.expression.expression, 'store'))) {
        const arg0 = n.arguments[0];
        const actionCall = arg0 && ts.isCallExpression(arg0) ? arg0 : undefined;
        const actionIdent = actionCall ? getIdentFromExpr(actionCall.expression) : getIdentFromExpr(arg0);
        if (actionIdent) {
          const target = ngrx.actionsByIdent.get(actionIdent);
          if (target) {
            addRelation(sf, 'DEPENDENCY' as IrRelationKind, c.id, target.id, n, [
              tag('origin', 'state'),
              tag('role', 'dispatches'),
              tag('state.kind', 'ngrx'),
              tag('state.action', actionIdent),
            ]);
          } else if (report) {
            addFinding(report, {
              kind: 'note',
              severity: 'info',
              message: `NgRx dispatch action not indexed: ${actionIdent}`,
              location: { file: sourceRefForNode(sf, n, projectRoot).file },
            });
          }
        }
      }

      // this.store.select(selector)
      if (method === 'select' && (isThisDotStore(n.expression.expression) || isIdent(n.expression.expression, 'store'))) {
        const selIdent = getIdentFromExpr(n.arguments[0]);
        if (selIdent) {
          const target = ngrx.selectorsByIdent.get(selIdent);
          if (target) {
            addRelation(sf, 'DEPENDENCY' as IrRelationKind, c.id, target.id, n, [
              tag('origin', 'state'),
              tag('role', 'selects'),
              tag('state.kind', 'ngrx'),
              tag('state.selector', selIdent),
            ]);
          }
        }
      }
    }

    // ofType(Action1, Action2) inside createEffect initializer: connect effect -> action
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'ofType') {
      // find enclosing effect variable name
      let cur: ts.Node | undefined = n;
      let effectName: string | undefined;
      while (cur) {
        if (ts.isCallExpression(cur) && isCallNamed(cur, 'createEffect')) {
          effectName = varNameForInit(cur);
          break;
        }
        cur = cur.parent;
      }
      if (effectName) {
        const eff = ngrx.effectsByIdent.get(effectName);
        if (eff) {
          for (const a of n.arguments) {
            const aName = getIdentFromExpr(a) ?? (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.name) ? a.name.text : undefined);
            if (!aName) continue;
            const action = ngrx.actionsByIdent.get(aName);
            if (action) {
              addRelation(sf, 'DEPENDENCY' as IrRelationKind, eff.id, action.id, n, [
                tag('origin', 'state'),
                tag('role', 'ofType'),
                tag('state.kind', 'ngrx'),
                tag('state.effect', effectName),
                tag('state.action', aName),
              ]);
            }
          }
        }
      }
    }

    ts.forEachChild(n, visit);
  };

  visit(node);
}
