#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './index';
import { buildFileInventory, writeFileInventoryFile } from './scan/inventory';

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

  await program.parseAsync(argv);

  return Number(process.exitCode ?? 0);
}

// Only run when invoked as a CLI.
// (Jest can import functions without executing main.)
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(process.argv);
