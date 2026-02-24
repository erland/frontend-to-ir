import ts from 'typescript';
import { safeNodeText } from '../../util/safeText';

export function readBooleanProp(obj: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (pn !== name) continue;
    const init = p.initializer;
    if (init.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (init.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  }
  return undefined;
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
