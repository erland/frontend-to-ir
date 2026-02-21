import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';
import { getArrayElementType } from './array';
import { primitiveTypeToIr } from './primitives';
import { unionToIr, intersectionToIr, isIntersectionLike } from './composite';
import { namedOrGenericToIr } from './namedGeneric';

/**
 * Convert a TypeScript type to IR TypeRef.
 * NOTE: Best-effort structural mapping intended to be schema-compliant.
 */
export function typeToIrTypeRef(type: ts.Type, checker: ts.TypeChecker): IrTypeRef {
  // Union / intersection
  if (type.isUnion()) {
    return unionToIr(type.types, (t) => typeToIrTypeRef(t, checker));
  }
  const parts = isIntersectionLike(type);
  if (parts) {
    return intersectionToIr(parts, (t) => typeToIrTypeRef(t, checker));
  }

  // Array
  const element = getArrayElementType(type, checker);
  if (element) {
    return { kind: 'ARRAY', elementType: typeToIrTypeRef(element, checker) };
  }

  // Primitives
  const prim = primitiveTypeToIr(type);
  if (prim) return prim;

  // Named / generic
  return namedOrGenericToIr(type, checker, (t) => typeToIrTypeRef(t, checker));
}
