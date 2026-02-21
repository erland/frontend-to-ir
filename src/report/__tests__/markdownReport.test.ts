import { reportToMarkdown } from '../markdownReport';
import { createEmptyReport } from '../extractionReport';

describe('markdownReport', () => {
  test('renders stable sections even when empty', () => {
    const r = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: '0.0.0', projectRoot: '/x' });
    r.filesScanned = 0;
    r.filesProcessed = 0;
    const md = reportToMarkdown(r);

    expect(md).toContain('# Extraction report');
    expect(md).toContain('## Counts');
    expect(md).toContain('### Classifiers by kind');
    expect(md).toContain('| (none) | 0 |');
    expect(md).toContain('## Findings summary');
    expect(md).toContain('## All findings');
  });

  test('escapes pipes and sorts findings deterministically', () => {
    const r = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: '0.0.0', projectRoot: '/x' });
    r.findings.push(
      {
        kind: 'unresolvedType',
        severity: 'warning',
        message: 'Missing|Type in A',
        location: { file: 'b.ts', line: 2, column: 1 },
      },
      {
        kind: 'note',
        severity: 'info',
        message: 'A note',
        location: { file: 'a.ts', line: 1 },
      },
      {
        kind: 'unresolvedType',
        severity: 'warning',
        message: 'Missing|Type in A',
        location: { file: 'a.ts', line: 1 },
      },
    );
    const md = reportToMarkdown(r);

    // Pipe must be escaped inside table cells.
    expect(md).toContain('Missing\\|Type');

    // Findings are sorted by kind, then location, then message.
    const idxNote = md.indexOf('| info | note |');
    const idxUnres = md.indexOf('| warning | unresolvedType |');
    expect(idxNote).toBeGreaterThan(0);
    expect(idxUnres).toBeGreaterThan(0);
    expect(idxNote).toBeLessThan(idxUnres);

    // Top unresolved section should exist and include aggregated count.
    expect(md).toContain('## Top unresolved');
    expect(md).toContain('### unresolvedType');
    expect(md).toMatch(/\| 2 \| Missing\\\|Type in A \|/);
  });
});
