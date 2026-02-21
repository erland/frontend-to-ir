import { ExtractionReport, ReportFinding } from './extractionReport';

function fmtLoc(f: ReportFinding): string {
  if (!f.location) return '';
  const { file, line, column } = f.location;
  if (line && column) return `${file}:${line}:${column}`;
  if (line) return `${file}:${line}`;
  return file;
}

function countByKind(findings: ReportFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

function topMessages(findings: ReportFinding[], kind: string, limit = 20): Array<{ message: string; count: number }> {
  const m = new Map<string, number>();
  for (const f of findings) {
    if (f.kind !== kind) continue;
    m.set(f.message, (m.get(f.message) ?? 0) + 1);
  }
  const arr = Array.from(m.entries()).map(([message, count]) => ({ message, count }));
  arr.sort((a, b) => (b.count - a.count) || a.message.localeCompare(b.message));
  return arr.slice(0, limit);
}

export function reportToMarkdown(report: ExtractionReport): string {
  const lines: string[] = [];
  const unresolved = report.findings.filter((f) => f.kind.startsWith('unresolved'));
  const byKind = countByKind(report.findings);

  lines.push(`# Extraction report`);
  lines.push('');
  lines.push(`- Tool: **${report.tool.name}** ${report.tool.version}`);
  lines.push(`- Project root: \`${report.projectRoot}\``);
  lines.push(`- Started: ${report.startedAtIso}`);
  lines.push(`- Finished: ${report.finishedAtIso}`);
  lines.push(`- Files scanned: **${report.filesScanned}**`);
  lines.push(`- Files processed: **${report.filesProcessed}**`);
  lines.push(`- Findings: **${report.findings.length}** (unresolved: **${unresolved.length}**)`);
  lines.push('');

  lines.push(`## Counts`);
  lines.push('');
  lines.push(`### Classifiers by kind`);
  lines.push('');
  lines.push(`| Kind | Count |`);
  lines.push(`|---|---:|`);
  const ck = Object.keys(report.counts.classifiersByKind).sort((a,b)=>a.localeCompare(b));
  for (const k of ck) lines.push(`| ${k} | ${report.counts.classifiersByKind[k]} |`);
  if (ck.length === 0) lines.push(`| (none) | 0 |`);
  lines.push('');

  lines.push(`### Relations by kind`);
  lines.push('');
  lines.push(`| Kind | Count |`);
  lines.push(`|---|---:|`);
  const rk = Object.keys(report.counts.relationsByKind).sort((a,b)=>a.localeCompare(b));
  for (const k of rk) lines.push(`| ${k} | ${report.counts.relationsByKind[k]} |`);
  if (rk.length === 0) lines.push(`| (none) | 0 |`);
  lines.push('');

  lines.push(`## Findings summary`);
  lines.push('');
  lines.push(`| Kind | Count |`);
  lines.push(`|---|---:|`);
  const fk = Object.keys(byKind).sort((a,b)=>a.localeCompare(b));
  for (const k of fk) lines.push(`| ${k} | ${byKind[k]} |`);
  if (fk.length === 0) lines.push(`| (none) | 0 |`);
  lines.push('');

  if (unresolved.length > 0) {
    lines.push(`## Top unresolved`);
    lines.push('');
    for (const kind of [
      'unresolvedType',
      'unresolvedImport',
      'unresolvedJsxComponent',
      'unresolvedContext',
      'unresolvedDecoratorRef',
      'unresolvedRouteTarget',
      'unresolvedLazyModule',
    ]) {
      const top = topMessages(unresolved, kind, 20);
      if (top.length === 0) continue;
      lines.push(`### ${kind}`);
      lines.push('');
      lines.push(`| Count | Message |`);
      lines.push(`|---:|---|`);
      for (const t of top) lines.push(`| ${t.count} | ${t.message.replace(/\|/g, '\\|')} |`);
      lines.push('');
    }
  }

  lines.push(`## All findings`);
  lines.push('');
  lines.push(`| Severity | Kind | Location | Message |`);
  lines.push(`|---|---|---|---|`);
  const all = [...report.findings];
  all.sort((a, b) => {
    const ak = a.kind.localeCompare(b.kind);
    if (ak !== 0) return ak;
    const al = fmtLoc(a).localeCompare(fmtLoc(b));
    if (al !== 0) return al;
    return a.message.localeCompare(b.message);
  });
  for (const f of all) {
    lines.push(`| ${f.severity} | ${f.kind} | ${fmtLoc(f)} | ${f.message.replace(/\|/g, '\\|')} |`);
  }
  if (all.length === 0) lines.push(`| (none) | (none) |  |  |`);
  lines.push('');
  return lines.join('\n');
}
