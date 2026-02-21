import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanSourceFiles } from '../sourceScanner';

async function mkFile(p: string, content = 'x'): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-to-ir-scan-'));
}

describe('scanSourceFiles', () => {
  test('returns stable sorted results across runs', async () => {
    const dir = await mkTempDir();
    await mkFile(path.join(dir, 'src/a.ts'));
    await mkFile(path.join(dir, 'src/b.tsx'));
    await mkFile(path.join(dir, 'src/c.js'));
    await mkFile(path.join(dir, 'src/z.jsx'));
    await mkFile(path.join(dir, 'src/ignore.d.ts'), 'declare const x: any;');

    const r1 = await scanSourceFiles({ sourceRoot: dir });
    const r2 = await scanSourceFiles({ sourceRoot: dir });

    expect(r1).toEqual(r2);
    expect(r1).toEqual([...r1].sort((a, b) => a.localeCompare(b)));
    expect(r1).toEqual(['src/a.ts', 'src/b.tsx', 'src/c.js', 'src/z.jsx']);
  });

  test('default excludes remove node_modules and tests unless includeTests=true', async () => {
    const dir = await mkTempDir();
    await mkFile(path.join(dir, 'src/app.ts'));
    await mkFile(path.join(dir, 'node_modules/pkg/index.js'));
    await mkFile(path.join(dir, 'src/__tests__/app.test.ts'));
    await mkFile(path.join(dir, 'src/foo.spec.ts'));

    const noTests = await scanSourceFiles({ sourceRoot: dir, includeTests: false });
    expect(noTests).toEqual(['src/app.ts']);

    const withTests = await scanSourceFiles({ sourceRoot: dir, includeTests: true });
    expect(withTests).toEqual(['src/__tests__/app.test.ts', 'src/app.ts', 'src/foo.spec.ts']);
  });

  test('additional excludes are applied', async () => {
    const dir = await mkTempDir();
    await mkFile(path.join(dir, 'src/app.ts'));
    await mkFile(path.join(dir, 'src/generated/gen.ts'));
    await mkFile(path.join(dir, 'src/generated/keep.ts'));

    const res = await scanSourceFiles({
      sourceRoot: dir,
      excludeGlobs: ['**/generated/**'],
      includeTests: true,
    });

    expect(res).toEqual(['src/app.ts']);
  });
});
