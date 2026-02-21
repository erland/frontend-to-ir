#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './index';
import { buildFileInventory, writeFileInventoryFile } from './scan/inventory';
import { extractTypeScriptStructuralModel } from './extract/ts/tsExtractor';
import { writeIrJsonFile } from './ir/writeIrJson';

type ExtractTsOptions = {
  project: string;
  out: string;
  tsconfig?: string;
  exclude?: string[];
  includeTests?: boolean;
  verbose?: boolean;
};

type ScanOptions = {
  project: string;
  out: string;
  exclude?: string[];
  includeTests?: boolean;
  verbose?: boolean;
};

async function main(argv: string[]): Promise<number> {
  const program = new Command();

  program
    .name('frontend-to-ir')
    .description('Convert frontend source code (TS/JS + frameworks) into IR v1 for java-to-xmi')
    .version(VERSION);

  program
    .command('scan')
    .description('Scan a project folder and emit a deterministic file inventory JSON (Step 3).')
    .requiredOption('-p, --project <path>', 'Project root folder to scan')
    .requiredOption('-o, --out <file>', 'Output JSON file')
    .option('-x, --exclude <glob...>', 'Additional exclude glob(s). Repeat or pass multiple.', [])
    .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts: ScanOptions) => {
      const inv = await buildFileInventory({
        sourceRoot: opts.project,
        excludeGlobs: opts.exclude ?? [],
        includeTests: Boolean(opts.includeTests),
      });

      await writeFileInventoryFile(opts.out, inv);

      if (opts.verbose) {
        // eslint-disable-next-line no-console
        console.log(`Scanned ${inv.files.length} source file(s). Wrote: ${opts.out}`);
      }
    });


program
  .command('extract-ts')
  .description('Extract TypeScript structural model into IR v1 JSON')
  .requiredOption('-p, --project <path>', 'Project root directory')
  .requiredOption('-o, --out <file>', 'Output IR JSON file')
  .option('--tsconfig <file>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
  .option('--exclude <glob...>', 'Exclude glob(s). Repeat or pass multiple.', [])
  .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .action(async (opts: ExtractTsOptions) => {
    const model = await extractTypeScriptStructuralModel({
      projectRoot: opts.project,
      tsconfigPath: opts.tsconfig,
      excludeGlobs: opts.exclude ?? [],
      includeTests: Boolean(opts.includeTests),
    });

    await writeIrJsonFile(opts.out, model);

    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(
        `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
      );
    }
  });
  await program.parseAsync(argv);

  return Number(process.exitCode ?? 0);
}

// Only run when invoked as a CLI.
// (Jest can import functions without executing main.)
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(process.argv);
