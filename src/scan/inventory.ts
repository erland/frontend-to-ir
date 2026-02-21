import path from 'node:path';
import fs from 'node:fs/promises';
import { stableStringify } from '../ir/deterministicJson';
import { scanSourceFiles, type SourceScanOptions } from './sourceScanner';

export type FileInventory = {
  schema: 'file-inventory-v1';
  sourceRoot: string;
  files: string[];
};

export async function buildFileInventory(opts: SourceScanOptions): Promise<FileInventory> {
  const files = await scanSourceFiles(opts);
  return {
    schema: 'file-inventory-v1',
    sourceRoot: path.resolve(opts.sourceRoot),
    files,
  };
}

export async function writeFileInventoryFile(outFile: string, inv: FileInventory): Promise<void> {
  const abs = path.resolve(outFile);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, stableStringify(inv), 'utf8');
}
