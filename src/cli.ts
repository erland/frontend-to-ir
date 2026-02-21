#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './index';
import { buildFileInventory, writeFileInventoryFile } from './scan/inventory';
import { extractTypeScriptStructuralModel } from './extract/ts/tsExtractor';
import { writeIrJsonFile } from './ir/writeIrJson';
import { createEmptyReport, finalizeReport } from './report/extractionReport';
import { writeReportFile } from './report/writeReport';

type ExtractTsOptions = {
  project: string;
  out: string;
  tsconfig?: string;
  exclude?: string[];
  includeTests?: boolean;
  verbose?: boolean;
  report?: string;
};

type ScanOptions = {
  project: string;
  out: string;
  exclude?: string[];
  includeTests?: boolean;
  verbose?: boolean;
};

type ExtractMode = 'ts' | 'react' | 'angular' | 'js';

type ExtractUnifiedOptions = ExtractTsOptions & { mode?: ExtractMode };

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
    .command('extract')
    .description('Extract IR v1 with a single command (choose mode: ts|react|angular|js).')
    .requiredOption('-p, --project <path>', 'Project root directory')
    .requiredOption('-o, --out <file>', 'Output IR JSON file')
    .option('-m, --mode <mode>', 'Extraction mode: ts|react|angular|js', 'ts')
    .option('--tsconfig <file>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
    .option('--exclude <glob...>', 'Exclude glob(s). Repeat or pass multiple.', [])
    .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
    .option('--report <file>', 'Write an extraction report JSON (Step 8)', '')
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts: ExtractUnifiedOptions) => {
      const mode = (opts.mode ?? 'ts') as ExtractMode;
      const report = opts.report
        ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.project })
        : undefined;

      const model = await extractTypeScriptStructuralModel({
        projectRoot: opts.project,
        tsconfigPath: opts.tsconfig,
        excludeGlobs: opts.exclude ?? [],
        includeTests: Boolean(opts.includeTests),
        react: mode === 'react',
        angular: mode === 'angular',
        forceAllowJs: mode === 'js',
        importGraph: mode === 'js',
        report,
      });

      await writeIrJsonFile(opts.out, model);
      if (report && opts.report) {
        await writeReportFile(opts.report, finalizeReport(report));
      }

      if (opts.verbose) {
        // eslint-disable-next-line no-console
        console.log(
          `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
        );
        if (report && opts.report) {
          // eslint-disable-next-line no-console
          console.log(`Wrote report: ${opts.report} (findings: ${report.findings.length})`);
        }
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
  .option('--report <file>', 'Write an extraction report JSON (Step 8)', '')
  .action(async (opts: ExtractTsOptions) => {
    const report = opts.report
      ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.project })
      : undefined;
    const model = await extractTypeScriptStructuralModel({
      projectRoot: opts.project,
      tsconfigPath: opts.tsconfig,
      excludeGlobs: opts.exclude ?? [],
      includeTests: Boolean(opts.includeTests),
      report,
    });

    await writeIrJsonFile(opts.out, model);

    if (report && opts.report) {
      await writeReportFile(opts.report, finalizeReport(report));
    }

    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(
        `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
      );
    }
  });

program
  .command('extract-react')
  .description('Extract TypeScript + React conventions (components + RENDER edges) into IR v1 JSON')
  .requiredOption('-p, --project <path>', 'Project root directory')
  .requiredOption('-o, --out <file>', 'Output IR JSON file')
  .option('--tsconfig <file>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
  .option('--exclude <glob...>', 'Exclude glob(s). Repeat or pass multiple.', [])
  .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .option('--report <file>', 'Write an extraction report JSON (Step 8)', '')
  .action(async (opts: ExtractTsOptions) => {
    const report = opts.report
      ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.project })
      : undefined;
    const model = await extractTypeScriptStructuralModel({
      projectRoot: opts.project,
      tsconfigPath: opts.tsconfig,
      excludeGlobs: opts.exclude ?? [],
      includeTests: Boolean(opts.includeTests),
      react: true,
      report,
    });

    await writeIrJsonFile(opts.out, model);

    if (report && opts.report) {
      await writeReportFile(opts.report, finalizeReport(report));
    }

    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(
        `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
      );
    }
  });

program
  .command('extract-angular')
  .description('Extract TypeScript + Angular conventions (decorators + DI/module edges) into IR v1 JSON')
  .requiredOption('-p, --project <path>', 'Project root directory')
  .requiredOption('-o, --out <file>', 'Output IR JSON file')
  .option('--tsconfig <file>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
  .option('--exclude <glob...>', 'Exclude glob(s). Repeat or pass multiple.', [])
  .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .option('--report <file>', 'Write an extraction report JSON (Step 8)', '')
  .action(async (opts: ExtractTsOptions) => {
    const report = opts.report
      ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.project })
      : undefined;
    const model = await extractTypeScriptStructuralModel({
      projectRoot: opts.project,
      tsconfigPath: opts.tsconfig,
      excludeGlobs: opts.exclude ?? [],
      includeTests: Boolean(opts.includeTests),
      angular: true,
      report,
    });

    await writeIrJsonFile(opts.out, model);

    if (report && opts.report) {
      await writeReportFile(opts.report, finalizeReport(report));
    }

    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(
        `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
      );
    }
  });

program
  .command('extract-js')
  .description('Extract JavaScript (allowJs) + import graph (best-effort) into IR v1 JSON')
  .requiredOption('-p, --project <path>', 'Project root directory')
  .requiredOption('-o, --out <file>', 'Output IR JSON file')
  .option('--tsconfig <file>', 'Path to tsconfig.json (relative to project root)', 'tsconfig.json')
  .option('--exclude <glob...>', 'Exclude glob(s). Repeat or pass multiple.', [])
  .option('--include-tests', 'Include tests (__tests__, *.test.*, *.spec.*)', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .option('--report <file>', 'Write an extraction report JSON (Step 8)', '')
  .action(async (opts: ExtractTsOptions) => {
    const report = opts.report
      ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.project })
      : undefined;
    const model = await extractTypeScriptStructuralModel({
      projectRoot: opts.project,
      tsconfigPath: opts.tsconfig,
      excludeGlobs: opts.exclude ?? [],
      includeTests: Boolean(opts.includeTests),
      forceAllowJs: true,
      importGraph: true,
      report,
    });

    await writeIrJsonFile(opts.out, model);

    if (report && opts.report) {
      await writeReportFile(opts.report, finalizeReport(report));
    }

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
