import fs from 'node:fs/promises';
import path from 'node:path';
import { ExtractionReport, serializeReport } from './extractionReport';
import { reportToMarkdown } from './markdownReport';

export type ReportFormat = 'json' | 'md';

export async function writeReportFile(outFile: string, report: ExtractionReport, format: ReportFormat = 'md'): Promise<void> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const content = format === 'json' ? serializeReport(report) : reportToMarkdown(report);
  await fs.writeFile(outFile, content, 'utf8');
}
