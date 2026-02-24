import ts from 'typescript';

export function memberName(m: ts.ClassElement): string | undefined {
  const anyM: any = m as any;
  const nameNode: ts.PropertyName | undefined = anyM.name;
  if (!nameNode) return undefined;
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  return undefined;
}
