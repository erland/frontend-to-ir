import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport, finalizeReport } from '../report/extractionReport';
import type { ExtractionReport } from '../report/extractionReport';
import type { IrModel } from '../ir/irV1';
import { VERSION } from '../index';

export type FrameworkMode = 'auto' | 'react' | 'angular' | 'none';

export type FrontendToIrOptions = {
  projectRoot: string;
  tsconfigPath?: string;
  excludeGlobs?: string[];
  includeTests?: boolean;
  /** Optional safety cap; if set, results are truncated deterministically after sorting. */
  maxFiles?: number;
  includeDeps?: boolean;
  includeFrameworkEdges?: boolean;
  framework?: FrameworkMode;
  /**
   * If true, the report will be generated (in-memory) even if you don't write it to disk.
   * Useful for servers.
   */
  trackUnresolved?: boolean;
};

export type FrontendToIrResult = {
  model: IrModel;
  report?: ExtractionReport;
  unresolvedCount: number;
};

/**
 * Core library entrypoint: generate IR v1 from a TS/JS/React/Angular project folder.
 *
 * - Does not write files.
 * - Returns the IR model and (optionally) a finalized report.
 */
export async function generateIrFromProject(opts: FrontendToIrOptions): Promise<FrontendToIrResult> {
  const framework: FrameworkMode = opts.framework ?? 'auto';
  const includeFrameworkEdges = opts.includeFrameworkEdges ?? true;

  const wantReport = Boolean(opts.trackUnresolved);
  const report = wantReport
    ? createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: VERSION, projectRoot: opts.projectRoot })
    : undefined;

  const reactEnabled = (framework === 'auto' || framework === 'react') && includeFrameworkEdges;
  const angularEnabled = (framework === 'auto' || framework === 'angular') && includeFrameworkEdges;

  const model = await extractTypeScriptStructuralModel({
    projectRoot: opts.projectRoot,
    tsconfigPath: opts.tsconfigPath,
    excludeGlobs: opts.excludeGlobs ?? [],
    includeTests: opts.includeTests ?? false,
    maxFiles: opts.maxFiles,
    react: reactEnabled || (framework === 'react' && !includeFrameworkEdges),
    angular: angularEnabled || (framework === 'angular' && !includeFrameworkEdges),
    forceAllowJs: true, // best-effort JS support
    importGraph: opts.includeDeps ?? false,
    includeDeps: opts.includeDeps ?? false,
    includeFrameworkEdges,
    report,
  });

  let unresolvedCount = 0;
  let finalReport: ExtractionReport | undefined;
  if (report) {
    finalReport = finalizeReport(report);
    unresolvedCount = finalReport.findings.filter((f) => f.kind.startsWith('unresolved')).length;
  }

  return { model, report: finalReport, unresolvedCount };
}
