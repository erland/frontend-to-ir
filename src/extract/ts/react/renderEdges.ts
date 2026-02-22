import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import path from 'node:path';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import type { ReactWorkContext } from './types';
import { toPosixPath } from './util';

function addRender(rctx: ReactWorkContext, sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node) {
  if (rctx.includeFrameworkEdges === false) return;
  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const id = hashId('r:', `RENDER:${relFile}:${fromId}->${toId}:${node.pos}`);
  rctx.model.relations = rctx.model.relations ?? [];
  if (rctx.model.relations.some((r) => r.id === id)) return;
  rctx.model.relations.push({
    id,
    kind: 'RENDER',
    sourceId: fromId,
    targetId: toId,
    taggedValues: [{ key: 'origin', value: 'jsx' }],
    source: rctx.sourceRefForNode(sf, node),
  });
}

function jsxTagText(tag: ts.JsxTagNameExpression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(tag)) return tag.text;
  return safeNodeText(tag, sf);
}

export function addJsxRenderEdges(rctx: ReactWorkContext, ownerByNode: Map<ts.Node, string>) {
  const { program, projectRoot, scannedRel, classifierByFileAndName } = rctx;
  const componentIdsByName = new Map<string, string>();
  for (const c of rctx.model.classifiers) {
    if (c.kind === 'COMPONENT') componentIdsByName.set(c.name, c.id);
  }

  for (const rel of scannedRel) {
    const abs = path.join(projectRoot, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));

    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) {
        const tagExpr = ts.isJsxSelfClosingElement(n) ? n.tagName : n.openingElement.tagName;
        const tag = jsxTagText(tagExpr, sf);
        if (rctx.isPascalCase(tag)) {
          const ownerName = ownerByNode.get(n) ?? '';
          const from = ownerName ? classifierByFileAndName.get(`${relFile}::${ownerName}`) : undefined;
          const toId = componentIdsByName.get(tag);
          if (from && toId) {
            addRender(rctx, sf, from.id, toId, n);
          } else if (from && !toId && rctx.report) {
            addFinding(rctx.report, {
              kind: 'unresolvedJsxComponent',
              severity: 'warning',
              message: `JSX renders '${tag}' but no matching component classifier was found`,
              location: (() => {
                const src = rctx.sourceRefForNode(sf, n);
                return { file: src.file, line: src.line ?? undefined, column: src.col ?? undefined };
              })(),
              tags: { owner: ownerName, component: tag, origin: 'jsx' },
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };

    visit(sf);
  }
}
