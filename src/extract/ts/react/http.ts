import ts from 'typescript';
import path from 'node:path';
import { hashId } from '../../../util/id';
import { safeNodeText } from '../util/safeText';
import { addFinding } from '../../../report/reportBuilder';
import type { ReactWorkContext } from './types';
import { toPosixPath, sourceRefForNode as reactSourceRefForNode } from './util';
import type { IrClassifier, IrTaggedValue } from '../../../ir/irV1';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function upper(s: string): string {
  return s.toUpperCase();
}

function ensureEndpointClassifier(rctx: ReactWorkContext, sf: ts.SourceFile, node: ts.Node, method: string, url: string, client: string, urlKind?: string): IrClassifier {
  const key = `http:endpoint:${client}:${upper(method)}:${url}`;
  const id = hashId('c:', key);
  const existing = rctx.model.classifiers.find((c) => c.id === id);
  if (existing) return existing;

  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const pkgDir = toPosixPath(path.dirname(relFile));
  const pkgKey = pkgDir === '.' ? '' : pkgDir;
  const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

  const c: IrClassifier = {
    id,
    kind: 'MODULE',
    name: `HTTP ${upper(method)} ${url}`,
    qualifiedName: key,
    packageId: pkgId,
    stereotypes: [{ name: 'HttpEndpoint' }],
    taggedValues: [
      tag('framework', 'react'),
      tag('http.client', client),
      tag('http.method', upper(method)),
      tag('http.url', url),
      ...(urlKind ? [tag('http.urlKind', urlKind)] : []),
    ],
    source: reactSourceRefForNode(sf, node, rctx.projectRoot),
  };
  rctx.model.classifiers.push(c);
  return c;
}

function getUrl(expr: ts.Expression | undefined): { url?: string; kind?: string } {
  if (!expr) return {};
  const e = ts.isAsExpression(expr) ? expr.expression : expr;

  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { url: e.text, kind: 'literal' };
  if (ts.isTemplateExpression(e)) return { url: safeNodeText(e), kind: 'template' };
  if (ts.isIdentifier(e)) return { url: e.text, kind: 'identifier' };
  return { url: safeNodeText(e), kind: 'expr' };
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

function methodFromSecondArg(arg1: ts.Expression | undefined): string | undefined {
  if (!arg1) return undefined;
  if (!ts.isObjectLiteralExpression(arg1)) return undefined;
  const m = readObjProp(arg1, 'method');
  if (!m) return undefined;
  if (ts.isStringLiteral(m) || ts.isNoSubstitutionTemplateLiteral(m)) return m.text.toLowerCase();
  return undefined;
}

export function addReactHttpEdges(rctx: ReactWorkContext, ownerByNode: Map<ts.Node, string>) {
  if (rctx.includeFrameworkEdges === false) return;
  rctx.model.relations = rctx.model.relations ?? [];

  const ownerNameFor = (n: ts.Node, sf: ts.SourceFile): string => {
    const direct = ownerByNode.get(n);
    if (direct) return direct;

    // climb to find enclosing function/class and see if it was marked
    let cur: ts.Node | undefined = n;
    while (cur) {
      const o = ownerByNode.get(cur);
      if (o) return o;
      cur = cur.parent;
    }
    return '';
  };

  for (const rel of rctx.scannedRel) {
    const abs = path.join(rctx.projectRoot, rel);
    const sf = rctx.program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        // fetch(url, { method })
        if (ts.isIdentifier(n.expression) && n.expression.text === 'fetch') {
          const { url, kind } = getUrl(n.arguments[0]);
          const m = methodFromSecondArg(n.arguments[1]) ?? 'get';
          const ownerName = ownerNameFor(n, sf);
          if (url && ownerName) {
            const from = rctx.classifierByFileAndName.get(`${relFile}::${ownerName}`);
            if (from) {
              const endpoint = ensureEndpointClassifier(rctx, sf, n, m, url, 'fetch', kind);
              const tags = [
                tag('origin', 'http'),
                tag('role', 'calls'),
                tag('http.client', 'fetch'),
                tag('http.method', upper(m)),
                tag('http.url', url),
                ...(kind ? [tag('http.urlKind', kind)] : []),
              ];
              const id = hashId('r:', `HTTP:${relFile}:${from.id}->${endpoint.id}:${upper(m)}:${url}:${n.pos}`);
              if (!rctx.model.relations!.some((r) => r.id === id)) {
                rctx.model.relations!.push({
                  id,
                  kind: 'DEPENDENCY',
                  sourceId: from.id,
                  targetId: endpoint.id,
                  taggedValues: tags,
                  stereotypes: [],
                  source: rctx.sourceRefForNode(sf, n),
                });
              }
            }
          } else if (!url && rctx.report) {
            addFinding(rctx.report, { kind: 'note', severity: 'info', message: 'Could not resolve fetch URL', location: { file: relFile } });
          }
        }

        // axios.get/post/... OR axios({ url, method })
        if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'axios') {
          const method = n.expression.name.text.toLowerCase();
          const { url, kind } = getUrl(n.arguments[0]);
          const ownerName = ownerNameFor(n, sf);
          if (url && ownerName) {
            const from = rctx.classifierByFileAndName.get(`${relFile}::${ownerName}`);
            if (from) {
              const endpoint = ensureEndpointClassifier(rctx, sf, n, method, url, 'axios', kind);
              const tags = [
                tag('origin', 'http'),
                tag('role', 'calls'),
                tag('http.client', 'axios'),
                tag('http.method', upper(method)),
                tag('http.url', url),
                ...(kind ? [tag('http.urlKind', kind)] : []),
              ];
              const id = hashId('r:', `HTTP:${relFile}:${from.id}->${endpoint.id}:${upper(method)}:${url}:${n.pos}`);
              if (!rctx.model.relations!.some((r) => r.id === id)) {
                rctx.model.relations!.push({
                  id,
                  kind: 'DEPENDENCY',
                  sourceId: from.id,
                  targetId: endpoint.id,
                  taggedValues: tags,
                  stereotypes: [],
                  source: rctx.sourceRefForNode(sf, n),
                });
              }
            }
          }
        } else if (ts.isIdentifier(n.expression) && n.expression.text === 'axios') {
          const arg0 = n.arguments[0];
          if (arg0 && ts.isObjectLiteralExpression(arg0)) {
            const urlExpr = readObjProp(arg0, 'url');
            const methodExpr = readObjProp(arg0, 'method');
            const { url, kind } = getUrl(urlExpr);
            const method =
              (methodExpr && (ts.isStringLiteral(methodExpr) || ts.isNoSubstitutionTemplateLiteral(methodExpr)) && methodExpr.text.toLowerCase()) ||
              'get';
            const ownerName = ownerNameFor(n, sf);
            if (url && ownerName) {
              const from = rctx.classifierByFileAndName.get(`${relFile}::${ownerName}`);
              if (from) {
                const endpoint = ensureEndpointClassifier(rctx, sf, n, method, url, 'axios', kind);
                const tags = [
                  tag('origin', 'http'),
                  tag('role', 'calls'),
                  tag('http.client', 'axios'),
                  tag('http.method', upper(method)),
                  tag('http.url', url),
                  ...(kind ? [tag('http.urlKind', kind)] : []),
                ];
                const id = hashId('r:', `HTTP:${relFile}:${from.id}->${endpoint.id}:${upper(method)}:${url}:${n.pos}`);
                if (!rctx.model.relations!.some((r) => r.id === id)) {
                  rctx.model.relations!.push({
                    id,
                    kind: 'DEPENDENCY',
                    sourceId: from.id,
                    targetId: endpoint.id,
                    taggedValues: tags,
                    stereotypes: [],
                    source: rctx.sourceRefForNode(sf, n),
                  });
                }
              }
            }
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }
}
