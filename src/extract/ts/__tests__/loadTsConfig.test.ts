import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTsConfig } from '../loadTsConfig';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fti-tsconfig-'));
}

describe('loadTsConfig', () => {
  test('throws when no tsconfig.json exists', () => {
    const dir = mkTmpDir();
    expect(() => loadTsConfig(dir)).toThrow(/Unable to find tsconfig\.json/);
  });

  test('supports tsconfig with extends', () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { target: 'ES2020' } }, null, 2));
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: './base.json',
          compilerOptions: { strict: true },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const x = 1;');

    const loaded = loadTsConfig(dir);
    expect(loaded.tsconfigPath.endsWith('tsconfig.json')).toBe(true);
    expect(typeof loaded.options.target).toBe('number');
    expect(loaded.fileNames.some((f) => f.endsWith(path.join('src', 'a.ts')))).toBe(true);
  });
});
