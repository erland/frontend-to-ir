import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('extractTypeScriptStructuralModel', () => {
  test('extracts classes/interfaces and basic relations deterministically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step4-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            strict: true,
            noEmit: true,
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    writeFile(
      path.join(dir, 'src', 'b.ts'),
      `
export interface IThing {
  id: string;
}

export class B implements IThing {
  id: string = "x";
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'a.ts'),
      `
import { B, IThing } from "./b";

export class A extends B {
  readonly child: B;
  constructor(child: B) {
    super();
    this.child = child;
  }
  getThing(x: IThing): B {
    return this.child;
  }
}
`,
    );

    const model1 = await extractTypeScriptStructuralModel({ projectRoot: dir, includeDeps: true });
    const model2 = await extractTypeScriptStructuralModel({ projectRoot: dir, includeDeps: true });

    expect(model1.schemaVersion).toBe('1.0');
    expect(model1.classifiers.length).toBeGreaterThanOrEqual(3);

    const names = model1.classifiers.map((c) => c.name).sort();
    expect(names).toEqual(expect.arrayContaining(['A', 'B', 'IThing']));

    // Deterministic
    expect(model1).toEqual(model2);

    const relKinds = (model1.relations ?? []).map((r) => r.kind);
    expect(relKinds).toEqual(expect.arrayContaining(['GENERALIZATION', 'REALIZATION']));
    expect(relKinds).toEqual(expect.arrayContaining(['ASSOCIATION', 'DEPENDENCY']));
  });
});
