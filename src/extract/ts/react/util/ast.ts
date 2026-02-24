import ts from 'typescript';

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
