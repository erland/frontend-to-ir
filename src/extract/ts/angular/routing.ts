import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import { normalizeRoutePath } from '../routing';
import type { IrModel, IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import { sourceRefForNode } from './util';
import { ensurePackageHierarchy } from '../packageHierarchy';
import path from 'node:path';

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

// Step 12: Angular routing extraction
// Best-effort parse of RouterModule.forRoot/forChild route arrays (and exported routes constants).
export function extractAngularRoutesFromSourceFile(args: {
  sf: ts.SourceFile;
  rel: string;
  projectRoot: string;
  model: IrModel;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
  markTarget?: (c: IrClassifier, stereo: string, tags?: Record<string, string>) => void;
}) {
  const { sf, rel, projectRoot, model, checker, classifierByName, addRelation, report, markTarget } = args;

  const routeClassifiersByKey = new Map<string, IrClassifier>();

  const ensureRouteClassifier = (key: string, routeName: string, routePath: string, lazy: boolean, sourceNode: ts.Node) => {
    if (routeClassifiersByKey.has(key)) return routeClassifiersByKey.get(key)!;
    const id = hashId('c:', `angular-route:${rel}:${key}:${sourceNode.pos}`);

    const relFile = toPosix(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosix(path.dirname(relFile));
    const dirParts = pkgDir === '.' ? [] : pkgDir.split('/').filter(Boolean);
    const pkgId = ensurePackageHierarchy(model as any, ['angular', 'routes', ...dirParts], 'virtual');

    const c: IrClassifier = {
      id,
      kind: 'MODULE',
      name: routeName,
      qualifiedName: `${rel}#route:${routePath}`,
      packageId: pkgId,
      stereotypes: [{ name: 'AngularRoute' }],
      taggedValues: [
        { key: 'framework', value: 'angular' },
        { key: 'angular.routePath', value: routePath },
        { key: 'angular.routeLazy', value: lazy ? 'true' : 'false' },
      ],
      source: sourceRefForNode(sf, sourceNode, projectRoot),
    };
    model.classifiers.push(c);
    routeClassifiersByKey.set(key, c);
    return c;
  };

  const resolveLocalArrayInitializer = (ident: ts.Identifier): ts.ArrayLiteralExpression | undefined => {
    // Only resolve within the same source file.
    const sym = checker.getSymbolAtLocation(ident);
    const decl = sym?.valueDeclaration;
    if (!decl) return undefined;
    if (ts.isVariableDeclaration(decl) && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
      return decl.initializer;
    }
    return undefined;
  };

  const getObjectProp = (obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (pn !== name) continue;
      return p.initializer;
    }
    return undefined;
  };

  const readString = (e: ts.Expression | undefined): string | undefined => {
    if (!e) return undefined;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    return undefined;
  };

  const readIdentifierName = (e: ts.Expression | undefined): string | undefined => {
    if (!e) return undefined;
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return undefined;
  };

    const readArrayIdentifierNames = (e: ts.Expression | undefined): string[] => {
    if (!e) return [];
    if (!ts.isArrayLiteralExpression(e)) return [];
    const out: string[] = [];
    for (const el of e.elements) {
      const n = readIdentifierName(el as any);
      if (n) out.push(n);
    }
    return out;
  };

  const readResolveTargets = (e: ts.Expression | undefined): { key: string; targetName: string }[] => {
    if (!e) return [];
    if (!ts.isObjectLiteralExpression(e)) return [];
    const out: { key: string; targetName: string }[] = [];
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (!key) continue;
      const targetName = readIdentifierName(p.initializer);
      if (targetName) out.push({ key, targetName });
    }
    return out;
  };

const parseLazyModuleName = (e: ts.Expression | undefined): { moduleName?: string; specifier?: string } => {
    // Handles: () => import('./x').then(m => m.FooModule)
    if (!e) return {};
    if (!ts.isArrowFunction(e) && !ts.isFunctionExpression(e)) return {};
    const body = e.body;
    const expr = ts.isBlock(body)
      ? (body.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement | undefined)?.expression
      : body;
    if (!expr || !ts.isCallExpression(expr)) return {};
    // expr should be: import('...').then(...)
    if (!ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== 'then') return {};
    const importCall = expr.expression.expression;
    let specifier: string | undefined;
    if (ts.isCallExpression(importCall) && importCall.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = readString(importCall.arguments[0]);
    }
    const thenArg = expr.arguments[0];
    if (!thenArg) return { specifier };
    if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
      const thenBody = thenArg.body;
      const thenExpr = ts.isBlock(thenBody)
        ? (thenBody.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement | undefined)?.expression
        : thenBody;
      if (thenExpr && ts.isPropertyAccessExpression(thenExpr)) {
        return { moduleName: thenExpr.name.text, specifier };
      }
    }
    return { specifier };
  };

  const addRouterEdge = (
    route: IrClassifier,
    role: 'component' | 'loadChildren' | 'loadComponent' | 'canActivate' | 'canActivateChild' | 'canDeactivate' | 'canLoad' | 'canMatch' | 'resolve',
    targetName: string,
    node: ts.Node,
    extraTags: Record<string, string> = {},
  ) => {
    const to = classifierByName.get(targetName);
    if (to) {
      addRelation(sf, 'DEPENDENCY', route.id, to.id, node, [
        { key: 'origin', value: 'router' },
        { key: 'role', value: role },
        ...Object.entries(extraTags).map(([key, value]) => ({ key, value })),
      ]);
      // Optional marking of target classifiers (guards/resolvers/etc.)
      if (markTarget) {
        if (role.startsWith('can')) markTarget(to, 'AngularGuard', { guardRole: role });
        if (role === 'resolve') markTarget(to, 'AngularResolver', { resolveKey: extraTags.resolveKey ?? '' });
      }
    } else if (report) {
      addFinding(report, {
        kind: (role === 'loadChildren' || role === 'loadComponent') ? 'unresolvedLazyModule' : 'unresolvedRouteTarget',
        severity: 'warning',
        message:
          (role === 'loadChildren' || role === 'loadComponent')
            ? `Lazy route target '${targetName}' was not found as a classifier`
            : `Route target '${targetName}' was not found as a classifier`,
        location: { file: rel },
        tags: { role, target: targetName, ...extraTags },
      });
    }
  };

  const parseRoutesArray = (arr: ts.ArrayLiteralExpression, originNode: ts.Node) => {
    let idx = 0;
    for (const el of arr.elements) {
      if (!ts.isObjectLiteralExpression(el)) {
        idx++;
        continue;
      }
      const pathVal = normalizeRoutePath(readString(getObjectProp(el, 'path')) ?? '');
      const compName = readIdentifierName(getObjectProp(el, 'component'));

      const lazyChildrenInfo = parseLazyModuleName(getObjectProp(el, 'loadChildren'));
      const lazyChildrenName = lazyChildrenInfo.moduleName;

      const lazyComponentInfo = parseLazyModuleName(getObjectProp(el, 'loadComponent'));
      const lazyComponentName = lazyComponentInfo.moduleName;

      const lazy = !!lazyChildrenName || !!lazyComponentName;

      const target = compName ?? lazyComponentName ?? lazyChildrenName ?? '(unknown)';
      const key = `${pathVal}::${target}::${idx}`;
      const routeName = `route:${pathVal || '(root)'} -> ${target}`;
      const routeC = ensureRouteClassifier(key, routeName, pathVal, lazy, el);

      if (compName) {
        addRouterEdge(routeC, 'component', compName, el);
      }
      if (lazyChildrenName) {
        const extra: Record<string, string> = {};
        if (lazyChildrenInfo.specifier) extra.specifier = lazyChildrenInfo.specifier;
        addRouterEdge(routeC, 'loadChildren', lazyChildrenName, el, extra);
      }
      if (lazyComponentName) {
        const extra: Record<string, string> = {};
        if (lazyComponentInfo.specifier) extra.specifier = lazyComponentInfo.specifier;
        addRouterEdge(routeC, 'loadComponent', lazyComponentName, el, extra);
      }

      // Guards
      for (const gf of ['canActivate', 'canActivateChild', 'canDeactivate', 'canLoad', 'canMatch'] as const) {
        const names = readArrayIdentifierNames(getObjectProp(el, gf));
        for (const n of names) addRouterEdge(routeC, gf, n, el);
      }

      // Resolvers: resolve: { key: Resolver }
      for (const rt of readResolveTargets(getObjectProp(el, 'resolve'))) {
        addRouterEdge(routeC, 'resolve', rt.targetName, el, { resolveKey: rt.key });
      }
      idx++;
    }
  };

  const routeVisit = (node: ts.Node) => {
    // RouterModule.forRoot([...]) / forChild([...])
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === 'forRoot' || name === 'forChild') {
        const lhs = node.expression.expression;
        const lhsName = ts.isIdentifier(lhs) ? lhs.text : ts.isPropertyAccessExpression(lhs) ? lhs.name.text : undefined;
        if (lhsName === 'RouterModule') {
          const a0 = node.arguments[0];
          let arr: ts.ArrayLiteralExpression | undefined;
          if (a0 && ts.isArrayLiteralExpression(a0)) arr = a0;
          else if (a0 && ts.isIdentifier(a0)) arr = resolveLocalArrayInitializer(a0);
          if (arr) parseRoutesArray(arr, node);
        }
      }
    }

    // export const routes: Routes = [...]
    if (ts.isVariableStatement(node)) {
      const isExport = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExport) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isArrayLiteralExpression(d.initializer)) continue;
          const varName = d.name.text;
          const typeText = safeNodeText(d.type, sf);
          if (varName.toLowerCase().includes('route') || typeText.includes('Routes')) {
            parseRoutesArray(d.initializer, d);
          }
        }
      }
    }

    ts.forEachChild(node, routeVisit);
  };

  routeVisit(sf);
}
