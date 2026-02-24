import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { IrModel } from './irV1';
import { canonicalizeIrModel } from './canonicalizeIrModel';
import { stripLegacyStereotypes } from './stereotypes/stripLegacyStereotypes';
import { stableStringify } from './deterministicJson';

export type WriteIrJsonOptions = {
  /** Pretty-print indentation (default 2). */
  space?: number;
};

/**
 * Write an IR model to disk in a deterministic form.
 */
export async function writeIrJsonFile(filePath: string, model: IrModel, options: WriteIrJsonOptions = {}): Promise<void> {
  // Output contract is IR schema v2-only JSON: legacy v1 `stereotypes` arrays are stripped at serialization time.
  const v2Only = stripLegacyStereotypes(model);
  const canonical = canonicalizeIrModel(v2Only);
  const json = stableStringify(canonical, options.space ?? 2);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, json, 'utf8');
}

/**
 * Serialize an IR model to a deterministic JSON string.
 */
export function serializeIrJson(model: IrModel, options: WriteIrJsonOptions = {}): string {
  // Output contract is IR schema v2-only JSON: legacy v1 `stereotypes` arrays are stripped at serialization time.
  const v2Only = stripLegacyStereotypes(model);
  const canonical = canonicalizeIrModel(v2Only);
  return stableStringify(canonical, options.space ?? 2);
}
