import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import path from 'node:path';
import type { IrSourceRef } from '../../../ir/irV1';

export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

export function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const lc = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  return { file: rel, line: lc.line + 1 };
}

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

export function readStringProp(obj: ts.ObjectLiteralExpression, name: string, sf: ts.SourceFile): string | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (pn !== name) continue;
    const init = p.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    return safeNodeText(init, sf);
  }
  return undefined;
}

export function readArrayIdentifiers(obj: ts.ObjectLiteralExpression, name: string): string[] {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (pn !== name) continue;
    const init = p.initializer;
    if (!ts.isArrayLiteralExpression(init)) return [];
    const out: string[] = [];
    for (const e of init.elements) {
      if (ts.isIdentifier(e)) out.push(e.text);
      else if (ts.isPropertyAccessExpression(e)) out.push(e.name.text);
    }
    return out;
  }
  return [];
}

export function decoratorArgString0(d: ts.Decorator): string | undefined {
  const expr = d.expression;
  if (!ts.isCallExpression(expr)) return undefined;
  const a0 = expr.arguments[0];
  if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) return a0.text;
  return undefined;
}

export function memberName(m: ts.ClassElement): string | undefined {
  const anyM: any = m as any;
  const nameNode: ts.PropertyName | undefined = anyM.name;
  if (!nameNode) return undefined;
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  return undefined;
}
