import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Import graph branches (refactor guardrails)', () => {
  test('records unresolved import and unresolved require findings (relative only) and handles circular imports', async () => {
    const dir = makeTempProject('f2ir-import-graph-');

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }),
    );

    writeFile(
      path.join(dir, 'src', 'a.ts'),
      `
      import { X } from './missing';
      export const a = 1;
      `,
    );

    writeFile(
      path.join(dir, 'src', 'b.ts'),
      `
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const y = require('./missing2');
      export const b = y;
      `,
    );

    // Circular pair (should not crash / infinite loop)
    writeFile(path.join(dir, 'src', 'c1.ts'), `import { c2 } from './c2'; export const c1 = c2 + 1;`);
    writeFile(path.join(dir, 'src', 'c2.ts'), `import { c1 } from './c1'; export const c2 = c1 + 1;`);

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeFrameworkEdges: false,
      includeDeps: true, // includeDeps enables importGraph edges when importGraph=true
      importGraph: true,
      react: false,
      angular: false,
      report,
    });

    // Findings should include unresolved import and require for relative specs
    const unresolved = report.findings.filter((f) => f.kind === 'unresolvedImport');
    expect(unresolved.length).toBeGreaterThanOrEqual(2);

    const hasImport = unresolved.some((f) => (f.tags as any)?.origin === 'import' && (f.tags as any)?.specifier === './missing');
    const hasRequire = unresolved.some((f) => (f.tags as any)?.origin === 'require' && (f.tags as any)?.specifier === './missing2');
    expect(hasImport).toBe(true);
    expect(hasRequire).toBe(true);

    // Circular import should still yield some relations among file modules
    expect((model.relations ?? []).length).toBeGreaterThan(0);
  });
});
