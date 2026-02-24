import type { IrClassifierKind, IrRelationKind } from '../irV1';

export type UmlMetaclass =
  | 'Class'
  | 'Interface'
  | 'Enumeration'
  | 'Package'
  | 'Property'
  | 'Operation'
  | 'Parameter'
  | 'Dependency'
  | 'Association'
  | 'Generalization'
  | 'InterfaceRealization'
  | 'NamedElement';

export function appliesToForClassifierKind(kind: IrClassifierKind): UmlMetaclass[] {
  switch (kind) {
    case 'INTERFACE':
      return ['Interface'];
    case 'ENUM':
      return ['Enumeration'];
    // For now, treat these as UML Classes in downstream UML:
    case 'CLASS':
    case 'RECORD':
    case 'TYPE_ALIAS':
    case 'FUNCTION':
    case 'COMPONENT':
    case 'SERVICE':
    case 'MODULE':
    default:
      return ['Class'];
  }
}

export function appliesToForRelationKind(kind: IrRelationKind): UmlMetaclass[] {
  switch (kind) {
    case 'GENERALIZATION':
      return ['Generalization'];
    case 'REALIZATION':
      return ['InterfaceRealization'];
    case 'ASSOCIATION':
    case 'COMPOSITION':
    case 'AGGREGATION':
      return ['Association'];
    case 'DEPENDENCY':
    case 'RENDER':
    case 'DI':
    case 'TEMPLATE_USES':
    case 'ROUTE_TO':
    default:
      return ['Dependency'];
  }
}

export function appliesToForAttribute(): UmlMetaclass[] {
  return ['Property'];
}

export function appliesToForOperation(): UmlMetaclass[] {
  return ['Operation'];
}
