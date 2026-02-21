import fs from 'node:fs/promises';
import path from 'node:path';
import { ExtractionReport, serializeReport } from './extractionReport';

export async function writeReportFile(outFile: string, report: ExtractionReport): Promise<void> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, serializeReport(report), 'utf8');
}
