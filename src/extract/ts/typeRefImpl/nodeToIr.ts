import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import { IrTypeRef } from '../../../ir/irV1';
import { typeToIrTypeRef } from './typeToIr';

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
    const name = safeNodeText(node.typeName);
    if (name) return { kind: 'NAMED', name };
  }

  return ir;
}
