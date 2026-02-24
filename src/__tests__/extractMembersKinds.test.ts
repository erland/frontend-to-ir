import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrAttribute, IrClassifier, IrOperation } from '../ir/irV1';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

describe('extractMembers split by kind (guardrail)', () => {
  it('extracts fields and methods but not accessors (current behavior)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-members-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'CommonJS',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        },
        null,
        2
      )
    );

    writeFile(
      path.join(dir, 'src', 'model.ts'),
      `
export class B {
  id!: string;
}

export class A {
  b!: B;

  foo(x: B): void {
    void x;
  }

  get bar(): B {
    return this.b;
  }

  set bar(v: B) {
    this.b = v;
  }
}
`
    );

    const report = createEmptyReport({
      toolName: 'frontend-to-ir',
      toolVersion: 'test',
      projectRoot: dir,
      startedAtIso: '2000-01-01T00:00:00.000Z',
    });

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      includeDeps: false,
      includeFrameworkEdges: false,
      react: false,
      angular: false,
      importGraph: false,
      report,
    });

    const clsA = (model.classifiers ?? []).find((c: IrClassifier) => c.name === 'A');
    expect(clsA).toBeTruthy();

    const attrNames = (clsA?.attributes ?? []).map((a: IrAttribute) => a.name).sort();
    expect(attrNames).toEqual(['b']);

    const opNames = (clsA?.operations ?? []).map((o: IrOperation) => o.name).sort();
    expect(opNames).toContain('foo');

    // Accessors are intentionally not extracted at the moment (kept stable across the split).
    expect(opNames).not.toContain('bar');
  });
});
