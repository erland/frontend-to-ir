import ts from 'typescript';
import path from 'node:path';

import { toPosixPath } from '../../../../util/id';

export function discoverPublicApiEntrypoints(args: {
  scannedRel: string[];
}): { scannedRel: string[]; relSet: Set<string> } {
  const { scannedRel } = args;
  return { scannedRel, relSet: new Set(scannedRel) };
}

export function createModuleResolver(args: {
  compilerOptions: ts.CompilerOptions;
  projectRoot: string;
  relSet: Set<string>;
}): (specifier: string, fromAbs: string) => string | null {
  const { compilerOptions, projectRoot, relSet } = args;

  return (specifier: string, fromAbs: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, fromAbs, compilerOptions, ts.sys).resolvedModule;
    if (!resolved?.resolvedFileName) return null;
    const rf = resolved.resolvedFileName;
    if (rf.endsWith('.d.ts')) return null;
    const rel = toPosixPath(path.relative(projectRoot, rf));
    return relSet.has(rel) ? rel : null;
  };
}
