import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runExtract } from '../cli';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fti-cliopts-'));
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('CLI options integration', () => {
  test('--include-deps toggles DEPENDENCY relations', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(
      path.join(dir, 'a.ts'),
      ['export class B {}', 'export class A {', '  m(b: B): B { return b; }', '}'].join('\n'),
      'utf8',
    );

    const outNo = path.join(dir, 'no.json');
    const outYes = path.join(dir, 'yes.json');

    await runExtract({
      source: dir,
      out: outNo,
      framework: 'none',
      exclude: [],
      includeTests: false,
      includeDeps: false,
      includeFrameworkEdges: true,
      failOnUnresolved: false,
      verbose: false,
    });

    await runExtract({
      source: dir,
      out: outYes,
      framework: 'none',
      exclude: [],
      includeTests: false,
      includeDeps: true,
      includeFrameworkEdges: true,
      failOnUnresolved: false,
      verbose: false,
    });

    const mNo = readJson(outNo);
    const mYes = readJson(outYes);

    const hasDepNo = (mNo.relations ?? []).some((r: any) => r.kind === 'DEPENDENCY');
    const hasDepYes = (mYes.relations ?? []).some((r: any) => r.kind === 'DEPENDENCY');
    expect(hasDepNo).toBe(false);
    expect(hasDepYes).toBe(true);
  });

  test('--include-framework-edges=false suppresses React RENDER edges', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(
      path.join(dir, 'app.tsx'),
      ["import React from 'react';", 'export const Button = () => <span/>;', 'export const App = () => (<div><Button/></div>);'].join(
        '\n',
      ),
      'utf8',
    );

    const out = path.join(dir, 'out.json');
    await runExtract({
      source: dir,
      out,
      framework: 'react',
      exclude: [],
      includeTests: false,
      includeDeps: false,
      includeFrameworkEdges: false,
      failOnUnresolved: false,
      verbose: false,
    });

    const model = readJson(out);
    const hasRender = (model.relations ?? []).some((r: any) => r.kind === 'RENDER');
    expect(hasRender).toBe(false);

    const app = (model.classifiers ?? []).find((c: any) => c.name === 'App');
    const btn = (model.classifiers ?? []).find((c: any) => c.name === 'Button');
    expect(app?.kind).toBe('COMPONENT');
    expect(btn?.kind).toBe('COMPONENT');
  });

  test('--max-files caps scanned files deterministically', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export class A {}');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export class B {}');
    fs.writeFileSync(path.join(dir, 'c.ts'), 'export class C {}');

    const out = path.join(dir, 'out.json');
    await runExtract({
      source: dir,
      out,
      framework: 'none',
      exclude: [],
      includeTests: false,
      includeDeps: false,
      includeFrameworkEdges: true,
      failOnUnresolved: false,
      maxFiles: 1,
      verbose: false,
    });

    const model = readJson(out);
    const names = (model.classifiers ?? []).map((c: any) => c.name);
    const abc = names.filter((n: string) => ['A', 'B', 'C'].includes(n));
    expect(abc.length).toBe(1);
  });
});
