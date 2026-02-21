import fg from 'fast-glob';
import path from 'node:path';

export type SourceScanOptions = {
  sourceRoot: string;
  /** Additional exclude globs (evaluated relative to sourceRoot). */
  excludeGlobs?: string[];
  /** When false, common test locations/patterns are excluded. */
  includeTests?: boolean;
  /** Optional safety cap; if set, results are truncated deterministically after sorting. */
  maxFiles?: number;
};

const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.turbo/**',
  '**/.svelte-kit/**',
  '**/.angular/**',
  '**/.nx/**',
  '**/out/**',
  '**/*.min.js',
  '**/*.d.ts',
];

const DEFAULT_TEST_EXCLUDES = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test/**',
  '**/tests/**',
];

const DEFAULT_INCLUDES = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
];

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Deterministically discovers source files in a project.
 * Returns a stable, sorted list of relative paths (posix-style) from sourceRoot.
 */
export async function scanSourceFiles(opts: SourceScanOptions): Promise<string[]> {
  const sourceRoot = path.resolve(opts.sourceRoot);
  const exclude = [...DEFAULT_EXCLUDES, ...(opts.excludeGlobs ?? [])];
  if (!opts.includeTests) exclude.push(...DEFAULT_TEST_EXCLUDES);

  const matches = await fg(DEFAULT_INCLUDES, {
    cwd: sourceRoot,
    onlyFiles: true,
    unique: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: exclude,
  });

  // fast-glob usually returns posix paths even on Windows, but normalize anyway
  const rel = matches.map((p) => toPosix(p));
  
  rel.sort((a, b) => a.localeCompare(b));
  if (opts.maxFiles && opts.maxFiles > 0 && rel.length > opts.maxFiles) {
    return rel.slice(0, opts.maxFiles);
  }
  return rel;

}
