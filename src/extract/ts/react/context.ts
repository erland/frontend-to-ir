import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import path from 'node:path';
import type { IrClassifier } from '../../../ir/irV1';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import type { ReactWorkContext } from './types';
import { toPosixPath } from './util';

function hasContextStereo(c: IrClassifier): boolean {
  return (c.stereotypes ?? []).some((st) => st.name === 'ReactContext');
}

function ensureContextClassifier(rctx: ReactWorkContext, sf: ts.SourceFile, node: ts.Node, name: string, typeNode?: ts.TypeNode | null): IrClassifier {
  const { projectRoot, model, classifierByFileAndName } = rctx;
  const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pkgDir = toPosixPath(path.dirname(relFile));
  const pkgKey = pkgDir === '.' ? '' : pkgDir;
  const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

  const key = `${relFile}::${name}`;
  let c = classifierByFileAndName.get(key);
  if (!c) {
    const existing = model.classifiers.filter((x) => x.name === name && hasContextStereo(x));
    if (existing.length === 1) c = existing[0];
  }

  if (!c) {
    const id = hashId('c:', `REACT_CONTEXT:${relFile}:${name}`);
    c = {
      id,
      name,
      qualifiedName: name,
      packageId: pkgId,
      kind: 'SERVICE',
      source: rctx.sourceRefForNode(sf, node),
      attributes: [],
      operations: [],
      stereotypes: [],
      taggedValues: [],
    };
    model.classifiers.push(c);
    classifierByFileAndName.set(key, c);
  }

  if (!c) throw new Error('ensureContextClassifier: invariant violated');

  c.kind = 'SERVICE';
  rctx.addStereotype(c, 'ReactContext');
  rctx.setClassifierTag(c, 'framework', 'react');
  if (typeNode) rctx.setClassifierTag(c, 'react.contextType', safeNodeText(typeNode, sf));
  return c;
}

function addDi(rctx: ReactWorkContext, sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node, origin: string) {
  if (rctx.includeFrameworkEdges === false) return;
  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const id = hashId('r:', `DI:${relFile}:${fromId}->${toId}:${origin}:${node.pos}`);
  rctx.model.relations = rctx.model.relations ?? [];
  if (rctx.model.relations.some((r) => r.id === id)) return;
  rctx.model.relations.push({
    id,
    kind: 'DI',
    sourceId: fromId,
    targetId: toId,
    taggedValues: [
      { key: 'origin', value: origin },
    ],
    source: rctx.sourceRefForNode(sf, node),
  });
}

export function detectReactContexts(rctx: ReactWorkContext) {
  const { program, projectRoot, scannedRel } = rctx;

  for (const rel of scannedRel) {
    const abs = path.join(projectRoot, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;

    sf.forEachChild((node: ts.Node) => {
      if (!ts.isVariableStatement(node)) return;
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        const init = d.initializer;
        if (!init) continue;

        // React.createContext<T>(...) or createContext<T>(...)
        if (ts.isCallExpression(init)) {
          const expr = init.expression;
          const isCreateContext =
            (ts.isIdentifier(expr) && expr.text === 'createContext') ||
            (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createContext');
          if (!isCreateContext) continue;
          const typeArg = init.typeArguments?.[0] ?? d.type ?? null;
          ensureContextClassifier(rctx, sf, d, name, typeArg);
        }
      }
    });
  }
}

export function addUseContextAndProviderEdges(rctx: ReactWorkContext, ownerByNode: Map<ts.Node, string>) {
  const { program, projectRoot, scannedRel, classifierByFileAndName, model } = rctx;

  const contextByName = new Map<string, string>();
  for (const c of model.classifiers) {
    if ((c.stereotypes ?? []).some((s) => s.name === 'ReactContext')) contextByName.set(c.name, c.id);
  }

  for (const rel of scannedRel) {
    const abs = path.join(projectRoot, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;

    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));

    const ownerNameFor = (n: ts.Node): string => {
      return ownerByNode.get(n) ?? ownerByNode.get(findEnclosingFunctionOrClass(n)) ?? '';
    };

    const visit = (n: ts.Node) => {
      // useContext(Ctx)
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const calleeName = ts.isIdentifier(callee) ? callee.text : undefined;
        if (calleeName === 'useContext') {
          const arg0 = n.arguments[0];
          const ctxName = arg0 && ts.isIdentifier(arg0) ? arg0.text : undefined;
          const ownerName = ownerNameFor(n);
          if (ctxName && ownerName) {
            const from = classifierByFileAndName.get(`${relFile}::${ownerName}`);
            const toId = contextByName.get(ctxName);
            if (from && toId) {
              addDi(rctx, sf, from.id, toId, n, 'useContext');
            } else if (from && !toId && rctx.report) {
              addFinding(rctx.report, {
                kind: 'unresolvedContext',
                severity: 'warning',
                message: `useContext('${ctxName}') but no matching context classifier was found`,
                location: (() => {
                  const src = rctx.sourceRefForNode(sf, n);
                  return { file: src.file, line: src.line ?? undefined, column: src.col ?? undefined };
                })(),
                tags: { owner: ownerName, context: ctxName, origin: 'useContext' },
              });
            }
          }
        }
      }

      // <Ctx.Provider>
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        const tagName = n.tagName;
        if (ts.isPropertyAccessExpression(tagName) && (tagName.name.text === 'Provider' || tagName.name.text === 'Consumer')) {
          const ctxName = safeNodeText(tagName.expression, sf);
          const origin = tagName.name.text === 'Provider' ? 'provider' : 'consumer';
          const ownerName = ownerNameFor(n);
          const from = ownerName ? classifierByFileAndName.get(`${relFile}::${ownerName}`) : undefined;
          const toId = contextByName.get(ctxName);
          if (from && toId) {
            addDi(rctx, sf, from.id, toId, n, origin);
          } else if (from && !toId && rctx.report) {
            addFinding(rctx.report, {
              kind: 'unresolvedContext',
              severity: 'warning',
              message: `JSX ${origin} for '${ctxName}' but no matching context classifier was found`,
              location: (() => {
                const src = rctx.sourceRefForNode(sf, n);
                return { file: src.file, line: src.line ?? undefined, column: src.col ?? undefined };
              })(),
              tags: { owner: ownerName, context: ctxName, origin },
            });
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }
}

function findEnclosingFunctionOrClass(node: ts.Node): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) || ts.isClassDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return node;
}
