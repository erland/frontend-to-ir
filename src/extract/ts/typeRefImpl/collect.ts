import ts from 'typescript';
import { getArrayElementType } from './array';
import { isIntersectionLike } from './composite';

/** Collect referenced named type symbols inside a TypeRef-like TypeScript type. */
export function collectReferencedTypeSymbols(type: ts.Type, checker: ts.TypeChecker, out: Set<ts.Symbol>): void {
  if (type.isUnion()) {
    type.types.forEach((t) => collectReferencedTypeSymbols(t, checker, out));
    return;
  }
  const parts = isIntersectionLike(type);
  if (parts) {
    parts.forEach((t) => collectReferencedTypeSymbols(t, checker, out));
    return;
  }
  const element = getArrayElementType(type, checker);
  if (element) {
    collectReferencedTypeSymbols(element, checker, out);
    return;
  }
  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    typeArgs.forEach((t) => collectReferencedTypeSymbols(t, checker, out));
  }
  const sym = type.getSymbol();
  if (sym) out.add(sym);
}
