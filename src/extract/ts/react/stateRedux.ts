import ts from 'typescript';
import path from 'node:path';
import { hashId } from '../../../util/id';
import { safeNodeText } from '../util/safeText';
import type { IrClassifier, IrTaggedValue } from '../../../ir/irV1';
import type { ReactWorkContext } from './types';
import { toPosixPath, sourceRefForNode as reactSourceRefForNode } from './util';
import { ensurePackageHierarchy } from '../packageHierarchy';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

type ReduxIndex = {
  slicesByIdent: Map<string, IrClassifier>;
  actionsByIdent: Map<string, IrClassifier>;
  selectorsByIdent: Map<string, IrClassifier>;
};

function ensureConcept(rctx: ReactWorkContext, sf: ts.SourceFile, node: ts.Node, stereotype: string, name: string, qualifiedKey: string): IrClassifier {
  const id = hashId('c:', qualifiedKey);
  const existing = rctx.model.classifiers.find((c) => c.id === id);
  if (existing) return existing;

  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const pkgDir = toPosixPath(path.dirname(relFile));
  const dirParts = pkgDir === '.' ? [] : pkgDir.split('/').filter(Boolean);
  const kindSeg = stereotype === 'ReduxSlice' ? 'slices' : stereotype === 'ReduxAction' ? 'actions' : 'selectors';
  const pkgId = ensurePackageHierarchy(rctx.model as any, ['react', 'redux', kindSeg, ...dirParts], 'virtual');

  const c: IrClassifier = {
    id,
    kind: 'MODULE',
    name,
    qualifiedName: qualifiedKey,
    packageId: pkgId,
    stereotypes: [{ name: stereotype }],
    taggedValues: [tag('framework', 'react'), tag('origin', 'state')],
    source: reactSourceRefForNode(sf, node, rctx.projectRoot),
  };
  rctx.model.classifiers.push(c);
  return c;
}

function isCallNamed(call: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(call.expression) && call.expression.text === name;
}

function varNameForInit(node: ts.Node): string | undefined {
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function readObjProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      const pn = p.name;
      const key = ts.isIdentifier(pn) ? pn.text : ts.isStringLiteral(pn) ? pn.text : undefined;
      if (key === name) return p.initializer;
    }
  }
  return undefined;
}

function getStringLiteral(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return undefined;
}

function collectReduxArtifacts(rctx: ReactWorkContext): ReduxIndex {
  const idx: ReduxIndex = { slicesByIdent: new Map(), actionsByIdent: new Map(), selectorsByIdent: new Map() };

  for (const rel of rctx.scannedRel) {
    const abs = path.join(rctx.projectRoot, rel);
    const sf = rctx.program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        // Redux Toolkit: createSlice({ name, reducers })
        if (isCallNamed(n, 'createSlice')) {
          const varName = varNameForInit(n);
          const arg0 = n.arguments[0];
          if (varName && arg0 && ts.isObjectLiteralExpression(arg0)) {
            const sliceName = getStringLiteral(readObjProp(arg0, 'name')) ?? varName;
            const key = `state:redux:slice:${sf.fileName}:${sliceName}`;
            const slice = ensureConcept(rctx, sf, n, 'ReduxSlice', sliceName, key);
            idx.slicesByIdent.set(varName, slice);

            // reducers keys become actions (best-effort)
            const reducers = readObjProp(arg0, 'reducers');
            if (reducers && ts.isObjectLiteralExpression(reducers)) {
              for (const p of reducers.properties) {
              let actionName: string | undefined;
              if (ts.isPropertyAssignment(p)) {
                const pn = p.name;
                actionName = ts.isIdentifier(pn) ? pn.text : ts.isStringLiteral(pn) ? pn.text : undefined;
              } else if (ts.isMethodDeclaration(p)) {
                const pn = p.name;
                actionName = ts.isIdentifier(pn) ? pn.text : ts.isStringLiteral(pn) ? pn.text : undefined;
              }
              if (!actionName) continue;

              const aKey = `state:redux:action:${sf.fileName}:${sliceName}/${actionName}`;
              const action = ensureConcept(rctx, sf, p, 'ReduxAction', `${sliceName}/${actionName}`, aKey);
              idx.actionsByIdent.set(actionName, action);
            }
            }
          }
        }

        // Reselect-style selectors: createSelector(...)
        if (isCallNamed(n, 'createSelector')) {
          const name = varNameForInit(n);
          if (name) {
            const key = `state:redux:selector:${sf.fileName}:${name}`;
            const sel = ensureConcept(rctx, sf, n, 'ReduxSelector', name, key);
            idx.selectorsByIdent.set(name, sel);
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }

  return idx;
}

function getOwnerName(ownerByNode: Map<ts.Node, string>, n: ts.Node): string | undefined {
  let cur: ts.Node | undefined = n;
  while (cur) {
    const o = ownerByNode.get(cur);
    if (o) return o;
    cur = cur.parent;
  }
  return undefined;
}


function getCalleeName(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  return undefined;
}
function getIdent(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

export function addReactStateEdges(rctx: ReactWorkContext, ownerByNode: Map<ts.Node, string>) {
  if (rctx.includeFrameworkEdges === false) return;
  rctx.model.relations = rctx.model.relations ?? [];

  const idx = collectReduxArtifacts(rctx);

  for (const rel of rctx.scannedRel) {
    const abs = path.join(rctx.projectRoot, rel);
    const sf = rctx.program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));

    const visit = (n: ts.Node) => {
      // useSelector(selectorIdent)
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useSelector') {
        const selIdent = getCalleeName(n.arguments[0]);
        const ownerName = getOwnerName(ownerByNode, n);
        if (selIdent && ownerName) {
          const from = rctx.classifierByFileAndName.get(`${relFile}::${ownerName}`);
          const sel = idx.selectorsByIdent.get(selIdent);
          if (from && sel) {
            const id = hashId('r:', `STATE:${relFile}:${from.id}->${sel.id}:selects:${n.pos}`);
            if (!rctx.model.relations!.some((r) => r.id === id)) {
              rctx.model.relations!.push({
                id,
                kind: 'DEPENDENCY',
                sourceId: from.id,
                targetId: sel.id,
                taggedValues: [
                  tag('origin', 'state'),
                  tag('role', 'selects'),
                  tag('state.kind', 'redux'),
                  tag('state.selector', selIdent),
                ],
                stereotypes: [],
                source: rctx.sourceRefForNode(sf, n),
              });
            }
          }
        }
      }

      // dispatch(actionCreator())
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'dispatch') {
        const arg0 = n.arguments[0];
        const actionCall = arg0 && ts.isCallExpression(arg0) ? arg0 : undefined;
        const actionIdent = actionCall ? getCalleeName(actionCall.expression) : getCalleeName(arg0 as any);
        const ownerName = getOwnerName(ownerByNode, n);
        if (actionIdent && ownerName) {
          const from = rctx.classifierByFileAndName.get(`${relFile}::${ownerName}`);
          const act = idx.actionsByIdent.get(actionIdent);
          if (from && act) {
            const id = hashId('r:', `STATE:${relFile}:${from.id}->${act.id}:dispatches:${n.pos}`);
            if (!rctx.model.relations!.some((r) => r.id === id)) {
              rctx.model.relations!.push({
                id,
                kind: 'DEPENDENCY',
                sourceId: from.id,
                targetId: act.id,
                taggedValues: [
                  tag('origin', 'state'),
                  tag('role', 'dispatches'),
                  tag('state.kind', 'redux'),
                  tag('state.action', actionIdent),
                ],
                stereotypes: [],
                source: rctx.sourceRefForNode(sf, n),
              });
            }
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }
}
