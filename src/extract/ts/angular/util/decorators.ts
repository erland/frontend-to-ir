import ts from 'typescript';
import { safeNodeText } from '../../util/safeText';

export function getDecorators(node: ts.Node): ts.Decorator[] {
  const anyTs: any = ts as any;
  if (typeof anyTs.getDecorators === 'function') return anyTs.getDecorators(node) ?? [];
  return (node as any).decorators ?? [];
}

export function decoratorCallName(d: ts.Decorator, sf: ts.SourceFile): string | undefined {
  const expr = d.expression;
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    return safeNodeText(callee, sf);
  }
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

export function getDecoratorArgObject(d: ts.Decorator): ts.ObjectLiteralExpression | undefined {
  const expr = d.expression;
  if (!ts.isCallExpression(expr)) return undefined;
  const arg0 = expr.arguments[0];
  return arg0 && ts.isObjectLiteralExpression(arg0) ? arg0 : undefined;
}

export function decoratorArgString0(d: ts.Decorator): string | undefined {
  const expr = d.expression;
  if (!ts.isCallExpression(expr)) return undefined;
  const a0 = expr.arguments[0];
  if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) return a0.text;
  return undefined;
}
