import { ExtractionReport, ReportFinding } from './extractionReport';

export function addFinding(report: ExtractionReport, finding: ReportFinding): void {
  report.findings.push(finding);
}

export function incCount(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}
