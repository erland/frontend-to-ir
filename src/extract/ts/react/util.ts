import ts from 'typescript';
import path from 'node:path';
import type { IrClassifier, IrSourceRef } from '../../../ir/irV1';

export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

export function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const lc = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  return { file: rel, line: lc.line + 1 };
}

export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

export function hasStereotype(c: IrClassifier, name: string): boolean {
  return (c.stereotypes ?? []).some((st) => st.name === name);
}

export function addStereotype(c: IrClassifier, name: string): void {
  c.stereotypes = c.stereotypes ?? [];
  if (!hasStereotype(c, name)) c.stereotypes.push({ name });
}

export function setClassifierTag(c: IrClassifier, key: string, value: string): void {
  c.taggedValues = c.taggedValues ?? [];
  const existing = c.taggedValues.find((tv) => tv.key === key);
  if (existing) existing.value = value;
  else c.taggedValues.push({ key, value });
}

export function unwrapParens(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

export function functionLikeReturnsJsx(fn: ts.SignatureDeclarationBase, sf: ts.SourceFile): boolean {
  // Arrow fn expression bodies
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
    const b = unwrapParens(fn.body);
    return ts.isJsxElement(b) || ts.isJsxSelfClosingElement(b) || ts.isJsxFragment(b);
  }

  const body = (fn as any).body as ts.Node | undefined;
  if (!body || !ts.isBlock(body)) return false;
  for (const st of body.statements) {
    if (ts.isReturnStatement(st) && st.expression) {
      const e = unwrapParens(st.expression);
      if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return true;
    }
  }
  return false;
}
