import path from 'node:path';
import { hashId, toPosixPath } from '../../../util/id';
import type { IrPackageInfo } from '../context';

export function buildPackageMap(filesAbs: string[], projectRoot: string): Map<string, IrPackageInfo> {
  const pkgByDir = new Map<string, IrPackageInfo>();

  const ensurePkg = (dirRel: string) => {
    const dir = dirRel === '.' ? '' : toPosixPath(dirRel);
    if (pkgByDir.has(dir)) return pkgByDir.get(dir)!;

    const parts = dir ? dir.split('/') : [];
    const name = parts.length ? parts[parts.length - 1] : '(root)';
    const qualifiedName = parts.length ? parts.join('.') : '(root)';
    const parentDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const parentId = parts.length ? hashId('pkg:', parentDir === '' ? '(root)' : parentDir) : undefined;
    const id = hashId('pkg:', dir === '' ? '(root)' : dir);

    const rec: IrPackageInfo = { id, name, qualifiedName, parentId };
    pkgByDir.set(dir, rec);

    if (parts.length > 0) ensurePkg(parentDir);
    return rec;
  };

  for (const abs of filesAbs) {
    const rel = path.relative(projectRoot, abs);
    ensurePkg(path.dirname(rel));
  }
  return pkgByDir;
}
