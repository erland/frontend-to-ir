import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';
import { getArrayElementType } from './array';
import { primitiveTypeToIr } from './primitives';
import { unionToIr, intersectionToIr, isIntersectionLike } from './composite';
import { namedOrGenericToIr } from './namedGeneric';

export type TypeToIrCtx = { seen: Set<number>; depth: number; maxDepth: number };

function getTypeId(type: ts.Type): number {
  const anyType: any = type as any;
  const id = anyType?.id;
  return typeof id === 'number' ? id : 0;
}

function nextCtx(ctx: TypeToIrCtx): TypeToIrCtx {
  return { seen: ctx.seen, depth: ctx.depth + 1, maxDepth: ctx.maxDepth };
}


/**
 * Convert a TypeScript type to IR TypeRef.
 * NOTE: Best-effort structural mapping intended to be schema-compliant.
 */
export function typeToIrTypeRef(type: ts.Type, checker: ts.TypeChecker, ctx?: TypeToIrCtx): IrTypeRef {
  const _ctx: TypeToIrCtx = ctx ?? { seen: new Set<number>(), depth: 0, maxDepth: 80 };
  if (_ctx.depth > _ctx.maxDepth) return { kind: 'NAMED', name: 'depth-limit' } as any;
  const id = getTypeId(type);
  if (id) {
    if (_ctx.seen.has(id)) return { kind: 'NAMED', name: 'recursive' } as any;
    _ctx.seen.add(id);
  }

  // Union / intersection
  if (type.isUnion()) {
    return unionToIr(type.types, (t) => typeToIrTypeRef(t, checker, nextCtx(_ctx)));
  }
  const parts = isIntersectionLike(type);
  if (parts) {
    return intersectionToIr(parts, (t) => typeToIrTypeRef(t, checker, nextCtx(_ctx)));
  }

  // Array
  const element = getArrayElementType(type, checker);
  if (element) {
    return { kind: 'ARRAY', elementType: typeToIrTypeRef(element, checker, nextCtx(_ctx)) };
  }

  // Primitives
  const prim = primitiveTypeToIr(type);
  if (prim) return prim;

  // Named / generic
  return namedOrGenericToIr(type, checker, (t) => typeToIrTypeRef(t, checker, nextCtx(_ctx)));
}