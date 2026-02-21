import { stableStringify } from '../ir/deterministicJson';

export type ReportSeverity = 'info' | 'warning' | 'error';

export type ReportLocation = {
  /** Relative file path (posix) within the scanned project root. */
  file: string;
  /** 1-based line number. */
  line?: number;
  /** 1-based column number. */
  column?: number;
};

export type ReportFindingKind =
  | 'unresolvedType'
  | 'unresolvedImport'
  | 'unresolvedJsxComponent'
  | 'unresolvedContext'
  | 'unresolvedDecoratorRef'
  | 'unresolvedRouteTarget'
  | 'unresolvedLazyModule'
  | 'note';

export type ReportFinding = {
  kind: ReportFindingKind;
  severity: ReportSeverity;
  message: string;
  location?: ReportLocation;
  tags?: Record<string, string>;
};

export type ExtractionReport = {
  schema: 'extraction-report-v1';
  tool: { name: string; version: string };
  projectRoot: string;
  startedAtIso: string;
  finishedAtIso: string;
  filesScanned: number;
  filesProcessed: number;
  counts: {
    classifiersByKind: Record<string, number>;
    relationsByKind: Record<string, number>;
  };
  findings: ReportFinding[];
};

export function createEmptyReport(args: {
  toolName: string;
  toolVersion: string;
  projectRoot: string;
  startedAtIso?: string;
}): ExtractionReport {
  const now = args.startedAtIso ?? new Date().toISOString();
  return {
    schema: 'extraction-report-v1',
    tool: { name: args.toolName, version: args.toolVersion },
    projectRoot: args.projectRoot,
    startedAtIso: now,
    finishedAtIso: now,
    filesScanned: 0,
    filesProcessed: 0,
    counts: { classifiersByKind: {}, relationsByKind: {} },
    findings: [],
  };
}

export function finalizeReport(report: ExtractionReport, finishedAtIso?: string): ExtractionReport {
  report.finishedAtIso = finishedAtIso ?? new Date().toISOString();
  return report;
}

export function serializeReport(report: ExtractionReport): string {
  // Keep it deterministic for tests and CI diffs.
  return stableStringify(report);
}
