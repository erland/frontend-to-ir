import Ajv from 'ajv/dist/2020';

import type { IrModel } from '../irV1';
import irSchema from '../schema/ir-schema-v1.json';

import { serializeIrJson } from '../writeIrJson';

function minimalValidModel(): IrModel {
  return {
    schemaVersion: '1.0',
    classifiers: [
      {
        id: 'c:A',
        name: 'A',
        kind: 'CLASS',
        qualifiedName: 'A',
        stereotypes: [{ name: 'Example' }],
        attributes: [{ name: 'x', type: { kind: 'UNKNOWN' } }],
        operations: [
          {
            name: 'm',
            returnType: { kind: 'UNKNOWN' },
            parameters: [{ name: 'p', type: { kind: 'UNKNOWN' } }],
          },
        ],
      },
    ],
    relations: [{ id: 'r:DEPENDENCY:c:A->c:A', kind: 'DEPENDENCY', sourceId: 'c:A', targetId: 'c:A' }],
  };
}

describe('IR schema compliance', () => {
  it('produces IR that validates against ir-schema-v1.json', () => {
    const model = minimalValidModel();

    // Ensure what we serialize is also what we validate (no hidden transforms).
    const json = serializeIrJson(model);
    const parsed = JSON.parse(json) as unknown;

    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(irSchema as any);
    const ok = validate(parsed);

    if (!ok) {
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(ok).toBe(true);
  });
});
