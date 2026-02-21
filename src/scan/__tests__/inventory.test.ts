import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFileInventory, writeFileInventoryFile } from '../inventory';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fti-inv-'));
}

describe('file inventory', () => {
  test('writes deterministic inventory JSON with sorted files', async () => {
    const dir = mkTmpDir();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'export const b = 1;');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;');

    const inv = await buildFileInventory({ sourceRoot: dir, excludeGlobs: [], includeTests: false });
    expect(inv.schema).toBe('file-inventory-v1');
    expect(inv.files).toEqual(['src/a.ts', 'src/b.ts']);

    const out = path.join(dir, 'inv.json');
    await writeFileInventoryFile(out, inv);
    const txt = fs.readFileSync(out, 'utf8');
    expect(txt.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(txt);
    expect(parsed.files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
