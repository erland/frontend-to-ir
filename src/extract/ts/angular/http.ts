import ts from 'typescript';
import type { IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import { safeNodeText } from '../util/safeText';
import { sourceRefForNode } from './util';
import type { AddAngularRelation } from './routing';
import path from 'node:path';
import { ensurePackageHierarchy } from '../packageHierarchy';

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'request']);

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function upper(s: string): string {
  return s.toUpperCase();
}

function tryResolveStringConstant(checker: ts.TypeChecker, ident: ts.Identifier): string | undefined {
  const sym = checker.getSymbolAtLocation(ident);
  const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (!decl) return undefined;

  // Only handle: const X = '...'; or const X = `...`;
  // (Best-effort, deterministic)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDecl: any = decl as any;
  const init: ts.Expression | undefined = anyDecl.initializer;
  if (!init) return undefined;

  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
  if (ts.isTemplateExpression(init)) return safeNodeText(init);
  return undefined;
}

function getUrlText(checker: ts.TypeChecker, expr: ts.Expression | undefined): { url?: string; kind?: string } {
  if (!expr) return {};
  const e = ts.isAsExpression(expr) ? expr.expression : expr;

  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { url: e.text, kind: 'literal' };
  if (ts.isTemplateExpression(e)) return { url: safeNodeText(e), kind: 'template' };
  if (ts.isIdentifier(e)) {
    const resolved = tryResolveStringConstant(checker, e);
    return { url: resolved ?? e.text, kind: resolved ? 'const' : 'identifier' };
  }
  // fallback to text (deterministic but may be noisy)
  return { url: safeNodeText(e), kind: 'expr' };
}

function isThisDotHttp(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === 'http'
  );
}

function isIdentifierNamed(expr: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expr) && expr.text === name;
}

function ensureEndpointClassifier(args: {
  sf: ts.SourceFile;
  projectRoot: string;
  model: { classifiers: IrClassifier[]; packages?: any[] };
  method: string;
  url: string;
  urlKind?: string;
  client: string;
  node: ts.Node;
}): IrClassifier {
  const { sf, projectRoot, model, method, url, urlKind, client, node } = args;
  const key = `http:endpoint:${client}:${upper(method)}:${url}`;
  const id = hashId('c:', key);
  let c = model.classifiers.find((x) => x.id === id);
  if (c) return c;

  const relFile = toPosix(path.relative(projectRoot, sf.fileName));
  const pkgDir = toPosix(path.dirname(relFile));
  const dirParts = pkgDir === '.' ? [] : pkgDir.split('/').filter(Boolean);
  const pkgId = ensurePackageHierarchy(model as any, ['http', 'endpoints', 'angular', ...dirParts], 'virtual');

  c = {
    id,
    kind: 'MODULE',
    name: `HTTP ${upper(method)} ${url}`,
    qualifiedName: key,
    packageId: pkgId,
    stereotypes: [{ name: 'HttpEndpoint' }],
    taggedValues: [
      tag('framework', 'angular'),
      tag('http.client', client),
      tag('http.method', upper(method)),
      tag('http.url', url),
      ...(urlKind ? [tag('http.urlKind', urlKind)] : []),
    ],
    source: sourceRefForNode(sf, node, projectRoot),
  };
  model.classifiers.push(c);
  return c;
}

export function extractAngularHttpEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  checker: ts.TypeChecker;
  model: { classifiers: IrClassifier[]; packages?: any[]; relations?: unknown[] };
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, projectRoot, node, c, checker, model, addRelation, report } = args;

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        const method = callee.name.text;
        if (HTTP_METHODS.has(method)) {
          const recv = callee.expression;

          // Best-effort match: this.http.<method>(...) or http.<method>(...)
          const isHttp =
            isThisDotHttp(recv) ||
            (ts.isPropertyAccessExpression(recv) && isIdentifierNamed(recv.expression, 'this') && ts.isIdentifier(recv.name) && recv.name.text === 'http') ||
            isIdentifierNamed(recv, 'http');

          if (isHttp) {
            let httpMethod = method;
            let urlExpr: ts.Expression | undefined = n.arguments[0];

            // request(method, url, ...)
            if (method === 'request') {
              const m0 = n.arguments[0];
              const u1 = n.arguments[1];
              const mtxt =
                (m0 && (ts.isStringLiteral(m0) || ts.isNoSubstitutionTemplateLiteral(m0)) && m0.text) ||
                (m0 && ts.isIdentifier(m0) && tryResolveStringConstant(checker, m0)) ||
                (m0 && ts.isIdentifier(m0) && m0.text) ||
                undefined;
              if (mtxt) httpMethod = mtxt.toLowerCase();
              urlExpr = u1;
            }

            const { url, kind } = getUrlText(checker, urlExpr);
            if (!url) {
              if (report) {
                addFinding(report, {
                  kind: 'note',
                  severity: 'info',
                  message: 'Could not resolve HttpClient URL argument',
                  location: { file: sourceRefForNode(sf, n, projectRoot).file },
                });
              }
              ts.forEachChild(n, visit);
              return;
            }

            const endpoint = ensureEndpointClassifier({
              sf,
              projectRoot,
              model,
              method: httpMethod,
              url,
              urlKind: kind,
              client: 'HttpClient',
              node: n,
            });

            const tags: IrTaggedValue[] = [
              tag('origin', 'http'),
              tag('role', 'calls'),
              tag('http.client', 'HttpClient'),
              tag('http.method', upper(httpMethod)),
              tag('http.url', url),
              ...(kind ? [tag('http.urlKind', kind)] : []),
            ];

            addRelation(sf, 'DEPENDENCY' as IrRelationKind, c.id, endpoint.id, n, tags);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  visit(node);
}
