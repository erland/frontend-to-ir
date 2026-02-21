#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './index';

type ScanOptions = {
  project: string;
  out: string;
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
    .description('Scan a project folder and emit IR v1 JSON (implementation comes in later steps)')
    .requiredOption('-p, --project <path>', 'Project root folder to scan')
    .requiredOption('-o, --out <file>', 'Output IR JSON file')
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts: ScanOptions) => {
      // Step 1 scaffolding: the command exists, but extraction is implemented in later steps.
      // Non-zero exit code to avoid accidental use.
      // eslint-disable-next-line no-console
      console.error(
        `scan is not implemented yet (project=${opts.project}, out=${opts.out}, verbose=${Boolean(opts.verbose)}). ` +
          'Implement Step 3+ to enable scanning and IR generation.'
      );
      process.exitCode = 2;
    });

  await program.parseAsync(argv);

  return Number(process.exitCode ?? 0);
}

// Only run when invoked as a CLI.
// (Jest can import functions without executing main.)
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(process.argv);
