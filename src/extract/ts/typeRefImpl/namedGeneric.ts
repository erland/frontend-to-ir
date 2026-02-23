import ts from 'typescript';
import { IrTaggedValue, IrTypeRef } from '../../../ir/irV1';

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

export type ResolveQualifiedNameFn = (sym: ts.Symbol) => string | undefined;

function withTaggedValues(ir: IrTypeRef, extra: IrTaggedValue[]): IrTypeRef {
  const taggedValues = [...(ir.taggedValues ?? []), ...extra];
  return { ...ir, taggedValues };
}

export function namedOrGenericToIr(
  type: ts.Type,
  checker: ts.TypeChecker,
  map: (t: ts.Type) => IrTypeRef,
  resolveQualifiedName?: ResolveQualifiedNameFn,
): IrTypeRef {
  const sym = type.getSymbol();

  // IMPORTANT: Never use TS printer strings as the *identity* of a type ref.
  // If we can resolve a stable qualified name (based on symbol declarations + package mapping),
  // prefer that for `name` so downstream tools can reliably bind the ref.
  let name: string;
  let extraTags: IrTaggedValue[] = [];
  if (sym && resolveQualifiedName) {
    const qn = resolveQualifiedName(sym);
    if (qn) {
      name = qn;
      const display = safeSymbolToString(checker, sym);
      if (display && display !== qn) extraTags.push({ key: 'ts.displayName', value: display });
    } else {
      name = safeSymbolToString(checker, sym);
    }
  } else {
    name = sym ? safeSymbolToString(checker, sym) : safeTypeToString(type, checker);
  }

  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    const ir: IrTypeRef = { kind: 'GENERIC', name, typeArgs: typeArgs.map(map) };
    return extraTags.length ? withTaggedValues(ir, extraTags) : ir;
  }
  const ir: IrTypeRef = { kind: 'NAMED', name };
  return extraTags.length ? withTaggedValues(ir, extraTags) : ir;
}
