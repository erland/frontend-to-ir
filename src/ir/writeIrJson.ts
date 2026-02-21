import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { IrModel } from './irV1';
import { canonicalizeIrModel } from './canonicalizeIrModel';
import { stableStringify } from './deterministicJson';

export type WriteIrJsonOptions = {
  /** Pretty-print indentation (default 2). */
  space?: number;
};

/**
 * Write an IR model to disk in a deterministic form.
 */
export async function writeIrJsonFile(filePath: string, model: IrModel, options: WriteIrJsonOptions = {}): Promise<void> {
  const canonical = canonicalizeIrModel(model);
  const json = stableStringify(canonical, options.space ?? 2);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, json, 'utf8');
}

/**
 * Serialize an IR model to a deterministic JSON string.
 */
export function serializeIrJson(model: IrModel, options: WriteIrJsonOptions = {}): string {
  const canonical = canonicalizeIrModel(model);
  return stableStringify(canonical, options.space ?? 2);
}
