import ts from 'typescript';
import path from 'node:path';

export type LoadedTsConfig = {
  projectRoot: string;
  tsconfigPath: string;
  options: ts.CompilerOptions;
  fileNames: string[];
};

/**
 * Loads tsconfig.json (or a provided config path) and returns parsed compiler options + file list.
 */
export function loadTsConfig(projectRoot: string, tsconfigPath?: string): LoadedTsConfig {
  const resolvedConfigPath = tsconfigPath
    ? path.isAbsolute(tsconfigPath)
      ? tsconfigPath
      : path.resolve(projectRoot, tsconfigPath)
    : ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');

  if (!resolvedConfigPath) {
    throw new Error(`Unable to find tsconfig.json under: ${projectRoot}`);
  }

  const read = ts.readConfigFile(resolvedConfigPath, ts.sys.readFile);
  if (read.error) {
    const msg = ts.flattenDiagnosticMessageText(read.error.messageText, '\n');
    throw new Error(`Failed to read tsconfig: ${resolvedConfigPath}\n${msg}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(resolvedConfigPath),
    /*existingOptions*/ undefined,
    resolvedConfigPath,
  );

  if (parsed.errors?.length) {
    const msg = parsed.errors
      .map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
      .join('\n');
    throw new Error(`Failed to parse tsconfig: ${resolvedConfigPath}\n${msg}`);
  }

  return {
    projectRoot,
    tsconfigPath: resolvedConfigPath,
    options: parsed.options,
    fileNames: parsed.fileNames,
  };
}
