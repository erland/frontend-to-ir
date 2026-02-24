import ts from 'typescript';

export function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  // IMPORTANT:
  // Do NOT use checker.isArrayLikeType here.
  // In large / heavily-generic codebases (we've seen this with the PWA modeller),
  // isArrayLikeType can trigger deep recursion inside TypeScript's type-relations
  // (isRelatedTo/isTypeAssignableTo) and overflow the stack.

  // 1) Array<T> / T[]
  try {
    if (checker.isArrayType(type)) {
      const tr = type as ts.TypeReference;
      const args = (checker.getTypeArguments ? checker.getTypeArguments(tr) : (tr.typeArguments as any)) ?? [];
      if (args && args.length === 1) return args[0];
    }
  } catch {
    // Defensive: some TS checker helpers can throw RangeError (stack overflow)
    // in pathological types. Treat as "not an array".
  }

  // 2) ReadonlyArray<T> and other Array-like aliases (heuristic based on symbol name)
  const sym = type.getSymbol();
  const name = sym ? checker.symbolToString(sym) : '';
  if (name === 'Array' || name === 'ReadonlyArray') {
    try {
      const tr = type as ts.TypeReference;
      const args = (checker.getTypeArguments ? checker.getTypeArguments(tr) : (tr.typeArguments as any)) ?? [];
      if (args && args.length === 1) return args[0];
    } catch {
      // ignore
    }
  }
  return null;
}
