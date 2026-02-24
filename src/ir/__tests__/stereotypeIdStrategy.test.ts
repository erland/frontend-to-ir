import { stableStereotypeId } from '../stereotypes/stereotypeId';

test('stableStereotypeId uses framework as namespace (lowercased) and preserves local name', () => {
  const id = stableStereotypeId('React', { name: 'ReactComponent', qualifiedName: null });
  expect(id).toBe('st:react.ReactComponent');
});

test('stableStereotypeId falls back to qualifiedName namespace when framework missing', () => {
  const id = stableStereotypeId(null, { name: 'Component', qualifiedName: 'Angular::Component' });
  expect(id).toBe('st:angular.Component');
});

test('stableStereotypeId sanitizes namespace and local name', () => {
  const id = stableStereotypeId('my fw', { name: 'My Stereotype!', qualifiedName: null });
  expect(id).toBe('st:my_fw.My_Stereotype_');
});
