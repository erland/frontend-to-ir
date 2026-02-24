import { buildStereotypeRegistryFromLegacy } from '../stereotypes/buildStereotypeRegistry';
import { createEmptyIrModel } from '../irV1';

test('buildStereotypeRegistryFromLegacy creates definitions + refs deterministically', () => {
  const m = createEmptyIrModel();
  m.classifiers.push({
    id: 'c:A',
    name: 'A',
    qualifiedName: 'A',
    packageId: null,
    kind: 'CLASS',
    visibility: 'PUBLIC',
    attributes: [],
    operations: [],
    stereotypes: [{ name: 'ReactComponent', qualifiedName: null }],
    taggedValues: [{ key: 'framework', value: 'react' }],
    source: null,
  });

  const out = buildStereotypeRegistryFromLegacy(m);

  expect(out.stereotypeDefinitions?.length).toBe(1);
  expect(out.stereotypeDefinitions?.[0].id).toBe('st:react.ReactComponent');

  const c = out.classifiers[0];
  expect(c.stereotypeRefs?.[0].stereotypeId).toBe('st:react.ReactComponent');
});
