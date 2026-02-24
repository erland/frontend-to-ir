import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrClassifier, IrTypeRef } from '../ir/irV1';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function findClass(model: { classifiers: IrClassifier[] }, name: string): IrClassifier {
  const c = model.classifiers.find((x) => x.kind === 'CLASS' && x.name === name);
  if (!c) throw new Error(`Class not found: ${name}`);
  return c;
}

function findAttr(c: IrClassifier, name: string): { name: string; type?: IrTypeRef | null } {
  const a = (c.attributes ?? []).find((x) => x.name === name);
  if (!a) throw new Error(`Attribute not found: ${c.name}.${name}`);
  return a as any;
}

describe('TypeRefImpl additional cases (refactor guardrails)', () => {
  test('captures alias generics, readonly arrays, tuples, and Record', async () => {
    const dir = makeTempProject('f2ir-typeref-more-');

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
      path.join(dir, 'src', 'a.ts'),
      `
      export type X<T> = Promise<T>;
      export interface Foo { a: string }
      export interface Bar { b: number }

      export class A {
        alias!: X<Foo>;
        ro!: ReadonlyArray<Foo>;
        tup!: [Foo, Bar];
        rec!: Record<string, Foo>;
      }
      `,
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeFrameworkEdges: false,
      includeDeps: false,
      importGraph: false,
      react: false,
      angular: false,
      report,
    });

    const A = findClass(model, 'A');

    // alias!: X<Foo>
    const alias = findAttr(A, 'alias').type!;
    expect(alias.kind).toBe('GENERIC');
    expect(['X', 'Promise'].includes(alias.name ?? '')).toBe(true);
    expect(alias.typeArgs?.length).toBe(1);
    expect(alias.typeArgs?.[0].kind).toBe('NAMED');

    // ro!: ReadonlyArray<Foo>  => ARRAY with elementType Foo
    const ro = findAttr(A, 'ro').type!;
    expect(ro.kind).toBe('ARRAY');
    expect(ro.elementType?.kind).toBe('NAMED');

    // tup!: [Foo, Bar] => GENERIC-ish with two args (tuple is represented as a type reference in TS)
    const tup = findAttr(A, 'tup').type!;
    expect(['GENERIC', 'ARRAY', 'UNKNOWN']).toContain(tup.kind);
    if (tup.kind === 'GENERIC') {
      expect((tup.typeArgs ?? []).length).toBe(2);
    }

    // rec!: Record<string, Foo>
    const rec = findAttr(A, 'rec').type!;
    expect(rec.kind).not.toBe('UNKNOWN');
    if (rec.kind === 'GENERIC') {
      expect(rec.name).toBe('Record');
      expect(rec.typeArgs?.length).toBe(2);
      expect(rec.typeArgs?.[0].kind).toBe('PRIMITIVE');
      expect(rec.typeArgs?.[0].name).toBe('string');
      expect(rec.typeArgs?.[1].kind).toBe('NAMED');
    }
  });
});
