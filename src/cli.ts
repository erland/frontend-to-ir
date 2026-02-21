#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from './index';
import { buildFileInventory, writeFileInventoryFile } from './scan/inventory';
import { extractTypeScriptStructuralModel } from './extract/ts/tsExtractor';
import { writeIrJsonFile } from './ir/writeIrJson';
import { createEmptyReport, finalizeReport } from './report/extractionReport';
import { writeReportFile } from './report/writeReport';

function parseBoolish(v: unknown, defaultValue: boolean): boolean {
  if (v === undefined || v === null) return defaultValue;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '') return true; // presence of option with no value
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return defaultValue;
}

function parseIntish(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

type FrameworkMode = 'auto' | 'react' | 'angular' | 'none';

type ExtractSpecOptions = {
  source: string;
  out: string;
  framework: FrameworkMode;
  exclude: string[];
  includeTests: boolean;
  includeDeps: boolean;
  includeFrameworkEdges: boolean;
  report?: string;
  failOnUnresolved: boolean;
  maxFiles?: number;
  tsconfig?: string;
  verbose: boolean;
};

export async function runExtract(opts: ExtractSpecOptions): Promise<number> {
  // Create a report object whenever we need unresolved tracking (either to write a report file
  // or to enforce --fail-on-unresolved).
  const report = opts.report || opts.failOnUnresolved
    ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.source })
    : undefined;

  const reactEnabled = (opts.framework === 'auto' || opts.framework === 'react') && opts.includeFrameworkEdges;
  const angularEnabled = (opts.framework === 'auto' || opts.framework === 'angular') && opts.includeFrameworkEdges;

  const model = await extractTypeScriptStructuralModel({
    projectRoot: opts.source,
    tsconfigPath: opts.tsconfig,
    excludeGlobs: opts.exclude,
    includeTests: opts.includeTests,
    react: reactEnabled || (opts.framework === 'react' && !opts.includeFrameworkEdges), // allow component marking even if edges disabled
    angular: angularEnabled || (opts.framework === 'angular' && !opts.includeFrameworkEdges),
    forceAllowJs: true, // Step 7: allow JS best-effort in all modes
    importGraph: opts.includeDeps, // import graph is "deps" per spec
    includeDeps: opts.includeDeps,
    includeFrameworkEdges: opts.includeFrameworkEdges,
    maxFiles: opts.maxFiles,
    report,
  });

  await writeIrJsonFile(opts.out, model);

  let unresolvedCount = 0;
  if (report) {
    const final = finalizeReport(report);
    unresolvedCount = final.findings.filter((f) => f.kind.startsWith('unresolved')).length;
    if (opts.report) await writeReportFile(opts.report, final, 'md');
  }

  if (opts.verbose) {
    // eslint-disable-next-line no-console
    console.log(
      `Extracted ${model.classifiers.length} classifier(s), ${model.relations?.length ?? 0} relation(s). Wrote: ${opts.out}`,
    );
    if (opts.report) {
      // eslint-disable-next-line no-console
      console.log(`Wrote report: ${opts.report} (unresolved: ${unresolvedCount})`);
    }
  }

  if (opts.failOnUnresolved && unresolvedCount > 0) return 3;
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const program = new Command();

  program
    .name('frontend-to-ir')
    .description('Convert TS/JS (optionally React/Angular) source code into IR v1 for java-to-xmi')
    .version(VERSION)
    // Spec-aligned options
    .requiredOption('--source <path>', 'Root directory to analyze', undefined)
    .requiredOption('--out <file>', 'Output IR JSON file path', undefined)
    .option('--framework <mode>', 'auto|react|angular|none', 'auto')
    .option('--exclude <glob...>', 'Repeatable exclude globs (relative to --source)', [])
    .option('--include-tests [bool]', 'Include tests (default false)', (v) => v, undefined)
    .option('--include-deps [bool]', 'Include dependency relations beyond structural associations (default false)', (v) => v, undefined)
    .option(
      '--include-framework-edges [bool]',
      'Include React RENDER / Angular DI/module edges (default true)',
      (v) => v,
      undefined,
    )
    .option('--report <file>', 'Optional Markdown report path', '')
    .option('--fail-on-unresolved [bool]', 'Exit nonzero if unresolved symbols > 0 (default false)', (v) => v, undefined)
    .option('--max-files <n>', 'Safety cap for huge repos (default no cap)', (v) => v, undefined)
    .option('--tsconfig <path>', 'Explicit tsconfig.json selection (overrides auto)', '')
    .option('-v, --verbose', 'Verbose logging', false);

  // Keep scan command as a utility (not in spec but helpful)
  program
    .command('scan')
    .description('Scan a project folder and emit a deterministic file inventory JSON.')
    .requiredOption('--source <path>', 'Root directory to scan')
    .requiredOption('--out <file>', 'Output JSON file')
    .option('--exclude <glob...>', 'Additional exclude glob(s).', [])
    .option('--include-tests [bool]', 'Include tests (default false)', (v) => v, undefined)
    .option('--max-files <n>', 'Safety cap (default no cap)', (v) => v, undefined)
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (raw: any) => {
      const includeTests = parseBoolish(raw.includeTests, false);
      const maxFiles = parseIntish(raw.maxFiles);
      const inv = await buildFileInventory({
        sourceRoot: raw.source,
        excludeGlobs: raw.exclude ?? [],
        includeTests,
        maxFiles,
      });
      await writeFileInventoryFile(raw.out, inv);
      if (raw.verbose) {
        // eslint-disable-next-line no-console
        console.log(`Scanned ${inv.files.length} source file(s). Wrote: ${raw.out}`);
      }
    });

  // Default action (spec expects no subcommand)
  program.action(async (raw: any) => {
    if (!raw.source || !raw.out) {
        // eslint-disable-next-line no-console
        console.error('Missing required options: --source <path> and --out <file>');
        process.exitCode = 1;
        return;
      }
      const framework = (String(raw.framework ?? 'auto').toLowerCase() as FrameworkMode) || 'auto';
    const includeTests = parseBoolish(raw.includeTests, false);
    const includeDeps = parseBoolish(raw.includeDeps, false);
    const includeFrameworkEdges = parseBoolish(raw.includeFrameworkEdges, true);
    const failOnUnresolved = parseBoolish(raw.failOnUnresolved, false);
    const maxFiles = parseIntish(raw.maxFiles);
    const tsconfig = raw.tsconfig && String(raw.tsconfig).trim() !== '' ? String(raw.tsconfig) : undefined;
    const report = raw.report && String(raw.report).trim() !== '' ? String(raw.report) : undefined;

    const exitCode = await runExtract({
      source: raw.source,
      out: raw.out,
      framework,
      exclude: raw.exclude ?? [],
      includeTests,
      includeDeps,
      includeFrameworkEdges,
      report,
      failOnUnresolved,
      maxFiles,
      tsconfig,
      verbose: Boolean(raw.verbose),
    });
    process.exitCode = exitCode;
  });

  try {
    await program.parseAsync(argv);
    return Number(process.exitCode ?? 0);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(e?.message ?? String(e));
    return 2;
  }
}

// Run CLI only when executed directly (not when imported in tests)
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
