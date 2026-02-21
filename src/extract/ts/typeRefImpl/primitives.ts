import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';

export function primitiveTypeToIr(type: ts.Type): IrTypeRef | null {
  const flags = type.getFlags();
  if (flags & ts.TypeFlags.StringLike) return { kind: 'PRIMITIVE', name: 'string' };
  if (flags & ts.TypeFlags.NumberLike) return { kind: 'PRIMITIVE', name: 'number' };
  if (flags & ts.TypeFlags.BooleanLike) return { kind: 'PRIMITIVE', name: 'boolean' };
  if (flags & ts.TypeFlags.BigIntLike) return { kind: 'PRIMITIVE', name: 'bigint' };
  if (flags & ts.TypeFlags.Void) return { kind: 'PRIMITIVE', name: 'void' };
  if (flags & ts.TypeFlags.Any) return { kind: 'UNKNOWN', name: 'any' };
  if (flags & ts.TypeFlags.Unknown) return { kind: 'UNKNOWN', name: 'unknown' };
  if (flags & ts.TypeFlags.Never) return { kind: 'PRIMITIVE', name: 'never' };
  return null;
}
