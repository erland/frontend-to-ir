import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Feature toggles (refactor guardrails)', () => {
  test('framework=none disables React/Angular enrichment', async () => {
    const dir = makeTempProject('frontend-to-ir-toggles-');
    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' }, include: ['src/**/*'] }, null, 2),
    );

    // React-like
    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `
        export function App() {
          return (<div><Button /></div>);
        }
        export const Button = () => (<span/>);
      `,
    );

    // Angular-like (local stubs)
    writeFile(path.join(dir, 'src', 'ng.ts'), `export function Component(_: any){ return (t:any)=>t }`);
    writeFile(
      path.join(dir, 'src', 'A.ts'),
      `
        import { Component } from './ng';
        @Component({ selector: 'a-comp' })
        export class A {}
      `,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      // "framework=none" => don't enable any framework enrichers
      react: false,
      angular: false,
      includeFrameworkEdges: true,
      includeDeps: true,
      importGraph: false,
      report: createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir, startedAtIso: '2000-01-01T00:00:00.000Z' }),
    });

    // No component upgrades without React/Angular enrichment
    expect(model.classifiers.some((c) => c.kind === 'COMPONENT')).toBe(false);
    expect(model.classifiers.some((c) => c.stereotypes?.some((s) => s.name === 'ReactComponent'))).toBe(false);
    expect(model.classifiers.some((c) => c.stereotypes?.some((s) => s.name === 'AngularComponent'))).toBe(false);
  });

  test('includeFrameworkEdges=true emits React RENDER edges when React enrichment is enabled', async () => {
    const dir = makeTempProject('frontend-to-ir-toggles-react-');
    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' }, include: ['src/**/*'] }, null, 2),
    );
    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `
        export function App() { return (<div><Button /></div>); }
        export function Button() { return (<span/>); }
      `,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      react: true,
      angular: false,
      includeFrameworkEdges: true,
      includeDeps: false,
      importGraph: false,
      report: createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir, startedAtIso: '2000-01-01T00:00:00.000Z' }),
    });

    expect(model.relations?.some((r) => r.kind === 'RENDER')).toBe(true);
  });

  test('includeDeps toggles SourceFile module classifiers (import graph)', async () => {
    const dir = makeTempProject('frontend-to-ir-toggles-deps-');
    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'CommonJS', allowJs: true }, include: ['src/**/*'] }, null, 2),
    );
    writeFile(path.join(dir, 'src', 'a.js'), `const b = require('./b'); module.exports = { b };`);
    writeFile(path.join(dir, 'src', 'b.js'), `module.exports = { x: 1 };`);

    const reportArgs = { toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir, startedAtIso: '2000-01-01T00:00:00.000Z' as const };

    const modelNoDeps = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      react: false,
      angular: false,
      includeFrameworkEdges: false,
      includeDeps: false,
      importGraph: false, // spec behavior: import graph is off when includeDeps=false
      forceAllowJs: true,
      report: createEmptyReport(reportArgs),
    });
    expect(modelNoDeps.classifiers.some((c) => c.stereotypes?.some((s) => s.name === 'SourceFile'))).toBe(false);

    const modelDeps = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      react: false,
      angular: false,
      includeFrameworkEdges: false,
      includeDeps: true,
      importGraph: true,
      forceAllowJs: true,
      report: createEmptyReport(reportArgs),
    });
    expect(modelDeps.classifiers.some((c) => c.stereotypes?.some((s) => s.name === 'SourceFile'))).toBe(true);
  });
});
