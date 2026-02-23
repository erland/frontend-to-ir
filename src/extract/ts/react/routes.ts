import ts from 'typescript';
import path from 'node:path';
import { hashId } from '../../../util/id';
import { safeNodeText } from '../util/safeText';
import { addFinding } from '../../../report/reportBuilder';
import type { ReactWorkContext } from './types';
import { toPosixPath, unwrapParens } from './util';

type RouteKind = 'jsx' | 'data';

function ensureRelations(rctx: ReactWorkContext) {
  rctx.model.relations = rctx.model.relations ?? [];
}

function addRouteRelation(
  rctx: ReactWorkContext,
  sf: ts.SourceFile,
  kind: 'DEPENDENCY',
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: { key: string; value: string }[],
) {
  if (rctx.includeFrameworkEdges === false) return;
  ensureRelations(rctx);
  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const role = tags.find((t) => t.key === 'role')?.value ?? '';
  const id = hashId('r:', `REACT_ROUTE:${relFile}:${fromId}->${toId}:${role}:${node.pos}`);
  if (rctx.model.relations!.some((r) => r.id === id)) return;
  rctx.model.relations!.push({
    id,
    kind,
    sourceId: fromId,
    targetId: toId,
    taggedValues: [{ key: 'origin', value: 'router' }, ...tags],
    source: rctx.sourceRefForNode(sf, node),
  });
}

function jsxTagText(tag: ts.JsxTagNameExpression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(tag)) return tag.text;
  return safeNodeText(tag, sf);
}

function readJsxAttr(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  for (const a of opening.attributes.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    const attrName = ts.isIdentifier(a.name)
      ? a.name.text
      : `${a.name.namespace.text}:${a.name.name.text}`;
    if (attrName === name) return a;
  }
  return undefined;
}

function readJsxString(attr: ts.JsxAttribute | undefined): string | undefined {
  if (!attr || !attr.initializer) return undefined;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer)) {
    const e = attr.initializer.expression;
    if (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) return e.text;
  }
  return undefined;
}

function readJsxBoolean(attr: ts.JsxAttribute | undefined): boolean {
  // <Route index /> has initializer undefined -> true
  if (!attr) return false;
  if (!attr.initializer) return true;
  if (ts.isJsxExpression(attr.initializer)) {
    const e = attr.initializer.expression;
    if (!e) return true;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  return false;
}

function elementToComponentName(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  const e = unwrapParens(expr);
  if (ts.isJsxSelfClosingElement(e)) {
    const tag = e.tagName;
    if (ts.isIdentifier(tag)) return tag.text;
  }
  if (ts.isJsxElement(e)) {
    const tag = e.openingElement.tagName;
    if (ts.isIdentifier(tag)) return tag.text;
  }
  return undefined;
}

function jsxAttrToComponentName(attr: ts.JsxAttribute | undefined): string | undefined {
  if (!attr || !attr.initializer) return undefined;
  if (ts.isJsxExpression(attr.initializer)) {
    const e = attr.initializer.expression;
    if (!e) return undefined;
    // element={<Comp/>}
    const comp = elementToComponentName(e);
    if (comp) return comp;
    // Component={Comp}
    if (ts.isIdentifier(e)) return e.text;
  }
  return undefined;
}

function buildComponentLookup(rctx: ReactWorkContext) {
  const byName = new Map<string, string>();
  for (const c of rctx.model.classifiers) {
    if (c.kind !== 'COMPONENT') continue;
    // If duplicates exist, prefer one already marked ReactComponent
    if (!byName.has(c.name)) byName.set(c.name, c.id);
    else {
      const existingId = byName.get(c.name)!;
      const existing = rctx.model.classifiers.find((x) => x.id === existingId);
      if (existing && !rctx.hasStereotype(existing, 'ReactComponent') && rctx.hasStereotype(c, 'ReactComponent')) {
        byName.set(c.name, c.id);
      }
    }
  }
  return byName;
}

function ensureRouteClassifier(
  rctx: ReactWorkContext,
  sf: ts.SourceFile,
  relFile: string,
  routeKind: RouteKind,
  routePath: string,
  index: boolean,
  node: ts.Node,
) {
  // Use a stable key per file+pos, since routes aren't named.
  const key = `${routeKind}:${relFile}:${node.pos}`;
  const existing = (rctx as any).__routeByKey as Map<string, any> | undefined;
  const map = existing ?? new Map<string, any>();
  (rctx as any).__routeByKey = map;
  if (map.has(key)) return map.get(key);

  const id = hashId('c:', `react-route:${routeKind}:${relFile}:${routePath}:${node.pos}`);
  const name = routePath ? `Route(${routePath})` : index ? 'Route(index)' : 'Route';
  const c = {
    id,
    kind: 'MODULE' as const,
    name,
    qualifiedName: `${relFile}#react-route:${routePath || (index ? 'index' : '')}`,
    stereotypes: [{ name: 'ReactRoute' }],
    taggedValues: [
      { key: 'framework', value: 'react' },
      { key: 'react.routerKind', value: routeKind },
      { key: 'react.routePath', value: routePath },
      { key: 'react.routeIndex', value: index ? 'true' : 'false' },
    ],
    source: rctx.sourceRefForNode(sf, node),
  };
  rctx.model.classifiers.push(c as any);
  map.set(key, c);
  return c as any;
}

function parseJsxRoutesInFile(rctx: ReactWorkContext, sf: ts.SourceFile, relFile: string, compIdsByName: Map<string, string>) {
  const stack: any[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) {
      const opening = ts.isJsxSelfClosingElement(n) ? n : n.openingElement;
      const tag = jsxTagText(opening.tagName, sf);

      const isRoute = tag === 'Route';
      if (isRoute) {
        const pathAttr = readJsxAttr(opening, 'path');
        const elementAttr = readJsxAttr(opening, 'element');
        const componentAttr = readJsxAttr(opening, 'Component');
        const indexAttr = readJsxAttr(opening, 'index');

        const routePath = readJsxString(pathAttr) ?? '';
        const index = readJsxBoolean(indexAttr);

        const routeC = ensureRouteClassifier(rctx, sf, relFile, 'jsx', routePath, index, n);

        // parent relationship
        const parent = stack.length ? stack[stack.length - 1] : undefined;
        if (parent) {
          addRouteRelation(rctx, sf, 'DEPENDENCY', parent.id, routeC.id, n, [
            { key: 'role', value: 'child' },
          ]);
        }

        // route -> component
        const targetName = jsxAttrToComponentName(elementAttr) ?? jsxAttrToComponentName(componentAttr);
        if (targetName) {
          const toId = compIdsByName.get(targetName);
          if (toId) {
            addRouteRelation(rctx, sf, 'DEPENDENCY', routeC.id, toId, n, [
              { key: 'role', value: 'component' },
            ]);
          } else if (rctx.report) {
            addFinding(rctx.report, {
              kind: 'unresolvedRouteTarget',
              severity: 'warning',
              message: `React route points to component '${targetName}' but no matching component classifier was found`,
            });
          }
        }

        // recurse into children (for <Route> ... </Route>)
        stack.push(routeC);
        ts.forEachChild(n, visit);
        stack.pop();
        return;
      }
    }
    ts.forEachChild(n, visit);
  };

  visit(sf);
}

function readObjProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (pn === name) return p.initializer;
  }
  return undefined;
}

function readStringLiteral(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return undefined;
}

function parseDataRoutesArray(
  rctx: ReactWorkContext,
  sf: ts.SourceFile,
  relFile: string,
  arr: ts.ArrayLiteralExpression,
  parentRoute: any | undefined,
  compIdsByName: Map<string, string>,
) {
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const pathVal = readStringLiteral(readObjProp(el, 'path')) ?? '';
    const indexVal = readObjProp(el, 'index')?.kind === ts.SyntaxKind.TrueKeyword;

    const routeC = ensureRouteClassifier(rctx, sf, relFile, 'data', pathVal, indexVal, el);
    if (parentRoute) {
      addRouteRelation(rctx, sf, 'DEPENDENCY', parentRoute.id, routeC.id, el, [{ key: 'role', value: 'child' }]);
    }

    const elementExpr = readObjProp(el, 'element');
    const compNameFromElement = elementToComponentName(elementExpr as any);
    const compPropExpr = readObjProp(el, 'Component');
    const compNameFromComponent = ts.isIdentifier(compPropExpr ?? ({} as any)) ? (compPropExpr as ts.Identifier).text : undefined;
    const targetName = compNameFromElement ?? compNameFromComponent;
    if (targetName) {
      const toId = compIdsByName.get(targetName);
      if (toId) {
        addRouteRelation(rctx, sf, 'DEPENDENCY', routeC.id, toId, el, [{ key: 'role', value: 'component' }]);
      } else if (rctx.report) {
        addFinding(rctx.report, {
          kind: 'unresolvedRouteTarget',
          severity: 'warning',
          message: `React route points to component '${targetName}' but no matching component classifier was found`,
        });
      }
    }

    const childrenExpr = readObjProp(el, 'children');
    if (childrenExpr && ts.isArrayLiteralExpression(childrenExpr)) {
      parseDataRoutesArray(rctx, sf, relFile, childrenExpr, routeC, compIdsByName);
    }
  }
}

function parseCreateBrowserRouterInFile(rctx: ReactWorkContext, sf: ts.SourceFile, relFile: string, compIdsByName: Map<string, string>) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (ts.isIdentifier(expr) && expr.text === 'createBrowserRouter') {
        const first = n.arguments[0];
        if (first && ts.isArrayLiteralExpression(first)) {
          parseDataRoutesArray(rctx, sf, relFile, first, undefined, compIdsByName);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

export function addReactRouteTableEdges(rctx: ReactWorkContext) {
  const { program, projectRoot, scannedRel } = rctx;
  const compIdsByName = buildComponentLookup(rctx);

  for (const rel of scannedRel) {
    const abs = path.join(projectRoot, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));

    parseJsxRoutesInFile(rctx, sf, relFile, compIdsByName);
    parseCreateBrowserRouterInFile(rctx, sf, relFile, compIdsByName);
  }
}
