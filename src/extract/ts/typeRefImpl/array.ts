import ts from 'typescript';

export function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  // Prefer TypeScript public APIs (getElementTypeOfArrayType is not always available).
  // 1) Array<T> / ReadonlyArray<T>
  if (checker.isArrayType(type) || checker.isArrayLikeType(type)) {
    const tr = type as ts.TypeReference;
    const args = (checker.getTypeArguments ? checker.getTypeArguments(tr) : (tr.typeArguments as any)) ?? [];
    if (args && args.length === 1) return args[0];
  }
  // 2) T[] (also usually captured by isArrayType/isArrayLikeType, but keep a fallback)
  const sym = type.getSymbol();
  const name = sym ? checker.symbolToString(sym) : '';
  if (name === 'Array' || name === 'ReadonlyArray') {
    const tr = type as ts.TypeReference;
    const args = (checker.getTypeArguments ? checker.getTypeArguments(tr) : (tr.typeArguments as any)) ?? [];
    if (args && args.length === 1) return args[0];
  }
  return null;
}
