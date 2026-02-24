import { appliesToForClassifierKind, appliesToForRelationKind } from '../stereotypes/appliesTo';

test('classifier kind maps to expected UML metaclass', () => {
  expect(appliesToForClassifierKind('CLASS')).toEqual(['Class']);
  expect(appliesToForClassifierKind('INTERFACE')).toEqual(['Interface']);
  expect(appliesToForClassifierKind('ENUM')).toEqual(['Enumeration']);
  expect(appliesToForClassifierKind('MODULE')).toEqual(['Class']);
});

test('relation kind maps to expected UML metaclass', () => {
  expect(appliesToForRelationKind('ASSOCIATION')).toEqual(['Association']);
  expect(appliesToForRelationKind('DEPENDENCY')).toEqual(['Dependency']);
  expect(appliesToForRelationKind('ROUTE_TO')).toEqual(['Dependency']);
  expect(appliesToForRelationKind('GENERALIZATION')).toEqual(['Generalization']);
  expect(appliesToForRelationKind('REALIZATION')).toEqual(['InterfaceRealization']);
});
