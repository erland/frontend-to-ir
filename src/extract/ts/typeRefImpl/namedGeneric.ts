import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';

function isStackOverflow(e: unknown): boolean {
  return e instanceof RangeError || (typeof (e as any)?.message === 'string' && (e as any).message.includes('Maximum call stack'));
}

function simpleTypeName(type: ts.Type): string {
  const anyType: any = type as any;
  const sym = anyType?.aliasSymbol ?? anyType?.symbol ?? anyType?.getSymbol?.();
  const name = sym?.getName?.();
  if (typeof name === 'string' && name.length > 0) return name;

  const targetSym = anyType?.target?.symbol;
  const targetName = targetSym?.getName?.();
  if (typeof targetName === 'string' && targetName.length > 0) return targetName;

  // Avoid any TS printer-based fallbacks here.
  if (type.isUnion()) return 'union';
  if (type.isIntersection && type.isIntersection()) return 'intersection';

  const flags = (type as any)?.flags as number | undefined;
  if (flags) {
    // best-effort rough categories
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.String) return 'string';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Number) return 'number';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Boolean) return 'boolean';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Void) return 'void';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Any) return 'any';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Unknown) return 'unknown';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Never) return 'never';
    // eslint-disable-next-line no-bitwise
    if (flags & ts.TypeFlags.Object) return 'object';
  }
  return 'unknown';
}

function safeSymbolToString(checker: ts.TypeChecker, sym: ts.Symbol): string {
  try {
    return checker.symbolToString(sym);
  } catch (e) {
    if (!isStackOverflow(e)) throw e;
    return (sym as any)?.getName?.() ?? 'unknown';
  }
}

function safeTypeToString(type: ts.Type, checker: ts.TypeChecker): string {
  try {
    return checker.typeToString(type);
  } catch (e) {
    if (!isStackOverflow(e)) throw e;
    // IMPORTANT: do NOT call any TS printer APIs from here, they can recurse too.
    try {
      return simpleTypeName(type);
    } catch {
      return 'unknown';
    }
  }
}

export function namedOrGenericToIr(type: ts.Type, checker: ts.TypeChecker, map: (t: ts.Type) => IrTypeRef): IrTypeRef {
  const sym = type.getSymbol();
  const name = sym ? safeSymbolToString(checker, sym) : safeTypeToString(type, checker);

  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    return { kind: 'GENERIC', name, typeArgs: typeArgs.map(map) };
  }
  return { kind: 'NAMED', name };
}
