import fs from 'node:fs';
import path from 'node:path';

import { serializeIrJson } from '../writeIrJson';
import { createEmptyIrModel } from '../irV1';
import { buildStereotypeRegistryFromLegacy } from '../stereotypes/buildStereotypeRegistry';
import type { IrModel } from '../irV1';

/**
 * Golden snapshot (byte-for-byte) for IR v2 stereotype registry + refs.
 *
 * This ensures:
 * - stableStringify + canonicalizeIrModel produce deterministic output
 * - stereotypeDefinitions + stereotypeRefs are emitted deterministically
 */
test('golden: IR v2 stereotype registry + refs', () => {
  const m: IrModel = createEmptyIrModel();

  m.classifiers.push({
    id: 'c:App',
    name: 'App',
    qualifiedName: 'App',
    packageId: null,
    kind: 'COMPONENT',
    visibility: 'PUBLIC',
    attributes: [],
    operations: [],
    stereotypes: [{ name: 'ReactComponent', qualifiedName: null }],
    taggedValues: [
      { key: 'framework', value: 'react' },
      { key: 'react.componentKind', value: 'function' },
    ],
    source: { file: 'src/App.tsx', line: 1, col: 1 },
  });

  m.relations = [
    {
      id: 'r:render:App->Child',
      kind: 'RENDER',
      sourceId: 'c:App',
      targetId: 'c:Child',
      name: null,
      stereotypes: [{ name: 'ReactRoute', qualifiedName: null }],
      taggedValues: [
        { key: 'framework', value: 'react' },
        { key: 'origin', value: 'jsx' },
      ],
      source: null,
    },
  ];

  const withV2 = buildStereotypeRegistryFromLegacy(m);
  const json = serializeIrJson(withV2);

  const fixture = fs.readFileSync(path.join(__dirname, '__fixtures__', 'golden_ir_v2_stereotypes.json'), 'utf8');
  expect(json).toBe(fixture);
});
