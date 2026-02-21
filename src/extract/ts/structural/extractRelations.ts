import ts from 'typescript';
import path from 'node:path';
import type { IrRelation, IrRelationKind } from '../../../ir/irV1';
import { hashId, toPosixPath } from '../../../util/id';
import type { ExtractionReport } from '../../../report/extractionReport';
import { incCount } from '../../../report/reportBuilder';
import { sourceRefForNode } from './util';

export function createRelationAdder(args: {
  projectRoot: string;
  includeDeps?: boolean;
  report?: ExtractionReport;
  relations: IrRelation[];
}) {
  const { projectRoot, includeDeps, report, relations } = args;

  return (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags?: { key: string; value: string }[],
  ) => {
    if (kind === 'DEPENDENCY' && !includeDeps) return;

    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const key = `${kind}:${relFile}:${fromId}->${toId}:${(tags ?? []).map((t) => `${t.key}=${t.value}`).join(',')}:${node.pos}`;
    const id = hashId('r:', key);

    const r: IrRelation = {
      id,
      kind,
      sourceId: fromId,
      targetId: toId,
      taggedValues: tags,
      source: sourceRefForNode(sf, node, projectRoot),
    };
    relations.push(r);
    if (report) incCount(report.counts.relationsByKind, kind);
  };
}

export function resolveDeclaredIdForType(args: {
  type: ts.Type;
  declared: Map<ts.Symbol, { id: string }>;
}): string | null {
  const sym = args.type.getSymbol();
  if (!sym) return null;
  const found = args.declared.get(sym);
  return found?.id ?? null;
}
