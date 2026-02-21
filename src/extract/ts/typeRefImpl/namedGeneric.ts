import ts from 'typescript';
import { IrTypeRef } from '../../../ir/irV1';

export function namedOrGenericToIr(type: ts.Type, checker: ts.TypeChecker, map: (t: ts.Type) => IrTypeRef): IrTypeRef {
  const sym = type.getSymbol();
  const name = sym ? checker.symbolToString(sym) : checker.typeToString(type);

  const typeArgs = checker.getTypeArguments?.(type as ts.TypeReference) ?? [];
  if (typeArgs && typeArgs.length > 0) {
    return { kind: 'GENERIC', name, typeArgs: typeArgs.map(map) };
  }
  return { kind: 'NAMED', name };
}
