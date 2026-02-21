import { serializeIrJson } from '../writeIrJson';
import type { IrModel } from '../irV1';

function makeModel(order: 'a' | 'b'): IrModel {
  const classifiers =
    order === 'a'
      ? [
          {
            id: 'c:Z',
            name: 'Z',
            qualifiedName: 'Z',
            kind: 'CLASS' as const,
            stereotypes: [{ name: 'B' }, { name: 'A' }],
            taggedValues: [
              { key: 'k2', value: 'v2' },
              { key: 'k1', value: 'v1' },
            ],
            attributes: [
              { id: 'a:Z.b', name: 'b', type: { kind: 'UNKNOWN' as const } },
              { id: 'a:Z.a', name: 'a', type: { kind: 'UNKNOWN' as const } },
            ],
          },
          { id: 'c:A', name: 'A', qualifiedName: 'A', kind: 'CLASS' as const },
        ]
      : [
          { id: 'c:A', name: 'A', qualifiedName: 'A', kind: 'CLASS' as const },
          {
            id: 'c:Z',
            name: 'Z',
            qualifiedName: 'Z',
            kind: 'CLASS' as const,
            stereotypes: [{ name: 'A' }, { name: 'B' }],
            taggedValues: [
              { key: 'k1', value: 'v1' },
              { key: 'k2', value: 'v2' },
            ],
            attributes: [
              { id: 'a:Z.a', name: 'a', type: { kind: 'UNKNOWN' as const } },
              { id: 'a:Z.b', name: 'b', type: { kind: 'UNKNOWN' as const } },
            ],
          },
        ];

  return {
    schemaVersion: '1.0',
    classifiers,
    relations: [
      { id: 'r:ASSOCIATION:c:Z->c:A', kind: 'ASSOCIATION', sourceId: 'c:Z', targetId: 'c:A' },
      { id: 'r:DEPENDENCY:c:A->c:Z', kind: 'DEPENDENCY', sourceId: 'c:A', targetId: 'c:Z' },
    ],
  };
}

describe('IR JSON writer', () => {
  it('serializes deterministically independent of input ordering', () => {
    const s1 = serializeIrJson(makeModel('a'));
    const s2 = serializeIrJson(makeModel('b'));
    expect(s1).toBe(s2);
  });

  it('sorts object keys (stable stringify)', () => {
    const s = serializeIrJson(makeModel('a'));
    // Top-level keys should be sorted alphabetically: classifiers, packages, relations, schemaVersion, taggedValues.
    // We don't need to assert full JSON - just that it starts with the expected first key.
    expect(s.trimStart().startsWith('{\n  "classifiers"')).toBe(true);
  });
});
