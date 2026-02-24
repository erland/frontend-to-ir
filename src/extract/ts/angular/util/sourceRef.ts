import ts from 'typescript';
import path from 'node:path';
import type { IrSourceRef } from '../../../../ir/irV1';
import { toPosixPath } from './path';

export function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const lc = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  return { file: rel, line: lc.line + 1 };
}
