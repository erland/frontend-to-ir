import ts from 'typescript';
import { getArrayElementType } from './array';
import { isIntersectionLike } from './composite';

/** Collect referenced named type symbols inside a TypeRef-like TypeScript type. */
export function collectReferencedTypeSymbols(type: ts.Type, checker: ts.TypeChecker, out: Set<ts.Symbol>): void {
  // Guard against self-referential / recursive types to avoid unbounded recursion in our own traversal.
  // (The stack overflow you're seeing is currently inside TypeScript's checker, but this also helps
  // keep our traversal safe once we avoid the problematic checker helper calls.)
  const visited = new WeakSet<ts.Type>();
  collectReferencedTypeSymbolsImpl(type, checker, out, visited);
}

function collectReferencedTypeSymbolsImpl(
  type: ts.Type,
  checker: ts.TypeChecker,
  out: Set<ts.Symbol>,
  visited: WeakSet<ts.Type>
): void {
  if (visited.has(type)) return;
  visited.add(type);

  if (type.isUnion()) {
    type.types.forEach((t) => collectReferencedTypeSymbolsImpl(t, checker, out, visited));
    return;
  }
  const parts = isIntersectionLike(type);
  if (parts) {
    parts.forEach((t) => collectReferencedTypeSymbolsImpl(t, checker, out, visited));
    return;
  }
  const element = getArrayElementType(type, checker);
  if (element) {
    collectReferencedTypeSymbolsImpl(element, checker, out, visited);
    return;
  }
  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    typeArgs.forEach((t) => collectReferencedTypeSymbolsImpl(t, checker, out, visited));
  }
  const sym = type.getSymbol();
  if (sym) out.add(sym);
}
