import { hashId } from '../../util/id';
import type { IrModel, IrPackage } from '../../ir/irV1';

/**
 * Ensure a hierarchical package chain exists under model.packages.
 * Intended for special "virtual" groupings like publicApi exports and react contracts.
 *
 * IDs are deterministic and names are the path segments. Hierarchy uses parentId.
 */
const cache = new WeakMap<IrModel, Map<string, string>>();

function getIndex(model: IrModel): Map<string, string> {
  let idx = cache.get(model);
  if (idx) return idx;
  idx = new Map<string, string>();
  for (const p of model.packages ?? []) {
    idx.set(p.id, p.id);
  }
  cache.set(model, idx);
  return idx;
}

function ensurePackage(model: IrModel, id: string, pkg: IrPackage) {
  const idx = getIndex(model);
  if (idx.has(id)) return;
  model.packages = model.packages ?? [];
  model.packages.push(pkg);
  idx.set(id, id);
}

/**
 * Create/ensure packages for parts[0..n], returning the leaf package id.
 *
 * @param namespace - a stable discriminator to avoid collisions with normal directory packages
 */
export function ensurePackageHierarchy(model: IrModel, parts: string[], namespace: string): string {
  let parentId: string | undefined = undefined;

  for (let i = 0; i < parts.length; i++) {
    const segs = parts.slice(0, i + 1);
    const key = `${namespace}:${segs.join('/')}`;
    const id = hashId('pkg:', key);

    ensurePackage(model, id, {
      id,
      name: parts[i],
      qualifiedName: segs.join('.'),
      parentId,
    });

    parentId = id;
  }

  return parentId ?? hashId('pkg:', `${namespace}:(root)`);
}
