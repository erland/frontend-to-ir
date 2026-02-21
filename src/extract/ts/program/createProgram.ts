import ts from 'typescript';
import path from 'node:path';
import { loadTsConfig } from '../loadTsConfig';

export type CreateProgramOptions = {
  projectRoot: string;
  /** Absolute paths to files to include as rootNames (scanner-controlled). */
  rootNamesAbs: string[];
  /** Optional tsconfig path (relative to projectRoot or absolute). */
  tsconfigPath?: string;
  /** Force JavaScript analysis even if tsconfig disables it. */
  forceAllowJs?: boolean;
};

export type CreatedProgram = {
  projectRoot: string;
  configPath?: string;
  compilerOptions: ts.CompilerOptions;
  program: ts.Program;
  checker: ts.TypeChecker;
};

/**
 * Creates a TypeScript program using compilerOptions from tsconfig.json when available,
 * but always uses the provided rootNamesAbs (scanner-controlled inventory).
 *
 * Throws if a tsconfigPath is provided but cannot be loaded/parsed.
 */
export function createProgramFromScan(opts: CreateProgramOptions): CreatedProgram {
  const projectRoot = path.resolve(opts.projectRoot);

  let compilerOptions: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true };
  let configPath: string | undefined;

  // If an explicit tsconfigPath is provided, require it to load.
  // Otherwise, use tsconfig.json if found; if not found, keep defaults.
  if (opts.tsconfigPath) {
    try {
      const loaded = loadTsConfig(projectRoot, opts.tsconfigPath);
      compilerOptions = { ...loaded.options, noEmit: true };
      configPath = loaded.tsconfigPath;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // If the tsconfig results in "No inputs" because JS is disabled, but the caller
      // explicitly requested forceAllowJs, treat this as non-fatal and continue with
      // scanner-driven rootNames.
      if (!(opts.forceAllowJs && msg.includes('No inputs were found in config file'))) {
        throw e;
      }
      // Keep defaults; configPath remains undefined in this fallback scenario.
    }
  } else {
    const found = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    if (found && ts.sys.fileExists(found)) {
      try {
        const loaded = loadTsConfig(projectRoot, found);
        compilerOptions = { ...loaded.options, noEmit: true };
        configPath = loaded.tsconfigPath;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // Some tsconfig files (especially in ad-hoc test fixtures) may have include globs
        // that do not match anything at parse time. Since we always drive rootNames from
        // the scanned file inventory, treat "No inputs were found" as non-fatal when the
        // tsconfig was auto-discovered.
        if (!msg.includes('No inputs were found in config file')) {
          throw e;
        }
      }
    }
  }

  if (opts.forceAllowJs) {
    compilerOptions = {
      ...compilerOptions,
      allowJs: true,
      checkJs: false,
      noEmit: true,
    };
  } else {
    // Always prevent emit.
    compilerOptions = { ...compilerOptions, noEmit: true };
  }

  const program = ts.createProgram({
    rootNames: opts.rootNamesAbs,
    options: compilerOptions,
  });
  const checker = program.getTypeChecker();

  return { projectRoot, configPath, compilerOptions, program, checker };
}
