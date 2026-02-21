import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractTypeScriptStructuralModel } from '../../extract/ts/tsExtractor';
import { createEmptyReport, finalizeReport } from '../extractionReport';

async function mkTmpProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-to-ir-report-'));
  await fs.writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', strict: true } }, null, 2),
    'utf8',
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('Extraction report (Step 8)', () => {
  it('tracks unresolved type references', async () => {
    const projectRoot = await mkTmpProject({
      'src/a.ts': `export class A { b!: MissingType; }`,
    });

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot });
    const model = await extractTypeScriptStructuralModel({ projectRoot, tsconfigPath: 'tsconfig.json', report });
    finalizeReport(report);

    expect(model.classifiers.find((c) => c.name === 'A')).toBeTruthy();
    expect(report.findings.some((f) => f.kind === 'unresolvedType' && f.message.includes('MissingType'))).toBe(true);
  });
});
