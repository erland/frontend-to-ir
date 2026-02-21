import ts from 'typescript';
import { IrTypeRef } from '../../ir/irV1';

function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
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


/**
 * Convert a TypeScript type to IR TypeRef.
 * NOTE: This is a best-effort structural mapping intended to be schema-compliant,
 * not a perfect semantic representation.
 */
export function typeToIrTypeRef(type: ts.Type, checker: ts.TypeChecker): IrTypeRef {
  // Union / intersection
  if (type.isUnion()) {
    return { kind: 'UNION', typeArgs: type.types.map((t) => typeToIrTypeRef(t, checker)) };
  }
  if (type.isIntersection()) {
    const parts: ts.Type[] = (type as any).types ?? [];
    return { kind: 'INTERSECTION', typeArgs: parts.map((t) => typeToIrTypeRef(t, checker)) };
  }

  // Array
  const element = getArrayElementType(type, checker);
  if (element) {
    return { kind: 'ARRAY', elementType: typeToIrTypeRef(element, checker) };
  }

  // Primitives
  const flags = type.getFlags();
  if (flags & ts.TypeFlags.StringLike) return { kind: 'PRIMITIVE', name: 'string' };
  if (flags & ts.TypeFlags.NumberLike) return { kind: 'PRIMITIVE', name: 'number' };
  if (flags & ts.TypeFlags.BooleanLike) return { kind: 'PRIMITIVE', name: 'boolean' };
  if (flags & ts.TypeFlags.BigIntLike) return { kind: 'PRIMITIVE', name: 'bigint' };
  if (flags & ts.TypeFlags.Void) return { kind: 'PRIMITIVE', name: 'void' };
  if (flags & ts.TypeFlags.Any) return { kind: 'UNKNOWN', name: 'any' };
  if (flags & ts.TypeFlags.Unknown) return { kind: 'UNKNOWN', name: 'unknown' };
  if (flags & ts.TypeFlags.Never) return { kind: 'PRIMITIVE', name: 'never' };

  // Named / generic
  const sym = type.getSymbol();
  const name = sym ? checker.symbolToString(sym) : checker.typeToString(type);

  // Type references (generics)
  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    return {
      kind: 'GENERIC',
      name,
      typeArgs: typeArgs.map((t) => typeToIrTypeRef(t, checker)),
    };
  }

  return { kind: 'NAMED', name };
}


/**
 * Convert a TypeScript TypeNode to IR TypeRef, preserving unresolved type reference names.
 * This helps when the checker resolves unknown identifiers to `any`, which would otherwise
 * lose the original type name (e.g., `MissingType`).
 */
export function typeNodeToIrTypeRef(node: ts.TypeNode, checker: ts.TypeChecker): IrTypeRef {
  // Preserve syntactic shape for common composite nodes.
  if (ts.isArrayTypeNode(node)) {
    return { kind: 'ARRAY', elementType: typeNodeToIrTypeRef(node.elementType, checker) };
  }
  if (ts.isUnionTypeNode(node)) {
    return { kind: 'UNION', typeArgs: node.types.map((t) => typeNodeToIrTypeRef(t, checker)) };
  }
  if (ts.isIntersectionTypeNode(node)) {
    return { kind: 'INTERSECTION', typeArgs: node.types.map((t) => typeNodeToIrTypeRef(t, checker)) };
  }

  const type = checker.getTypeFromTypeNode(node);
  const ir = typeToIrTypeRef(type, checker);

  // If the checker degraded an unresolved reference to `any/unknown`, recover the written name.
  if (ir.kind === 'UNKNOWN' && ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name) return { kind: 'NAMED', name };
  }

  return ir;
}

/** Collect referenced named type symbols inside a TypeRef-like TypeScript type. */
export function collectReferencedTypeSymbols(
  type: ts.Type,
  checker: ts.TypeChecker,
  out: Set<ts.Symbol>,
): void {
  if (type.isUnion()) {
    type.types.forEach((t) => collectReferencedTypeSymbols(t, checker, out));
    return;
  }
  if (type.isIntersection()) {
    const parts: ts.Type[] = (type as any).types ?? [];
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