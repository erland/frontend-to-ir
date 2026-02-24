import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrModel } from '../ir/irV1';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Structural relations (refactor guardrails)', () => {
  test('emits GENERALIZATION, REALIZATION, and ASSOCIATION between classifiers', async () => {
    const dir = makeTempProject('f2ir-struct-rel-');

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }),
    );

    writeFile(
      path.join(dir, 'src', 'model.ts'),
      `
      export interface IThing { id: string }
      export class Base { baseField = 1; }
      export class A extends Base implements IThing {
        id = 'x';
        b: Base = new Base();
        m(x: IThing): Base { return this.b; }
      }
      `,
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model: IrModel = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeDeps: true,
      report,
    });

    const byName = new Map(model.classifiers.map((c) => [c.name, c]));
    const A = byName.get('A');
    const Base = byName.get('Base');
    const IThing = byName.get('IThing');

    expect(A).toBeTruthy();
    expect(Base).toBeTruthy();
    expect(IThing).toBeTruthy();

    const rel = (kind: string, from: string, to: string) =>
      (model.relations ?? []).some((r) => r.kind === kind && r.sourceId === from && r.targetId === to);

    expect(rel('GENERALIZATION', A!.id, Base!.id)).toBe(true);
    expect(rel('REALIZATION', A!.id, IThing!.id)).toBe(true);

    // field b: Base should produce an ASSOCIATION
    expect(rel('ASSOCIATION', A!.id, Base!.id)).toBe(true);
  });
});
