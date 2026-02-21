import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';

export function unionToIr(types: ts.Type[], map: (t: ts.Type) => IrTypeRef): IrTypeRef {
  return { kind: 'UNION', typeArgs: types.map(map) };
}

export function intersectionToIr(types: ts.Type[], map: (t: ts.Type) => IrTypeRef): IrTypeRef {
  return { kind: 'INTERSECTION', typeArgs: types.map(map) };
}

export function isIntersectionLike(type: ts.Type): ts.Type[] | null {
  if (!type.isIntersection()) return null;
  const parts: ts.Type[] = (type as any).types ?? [];
  return parts;
}
