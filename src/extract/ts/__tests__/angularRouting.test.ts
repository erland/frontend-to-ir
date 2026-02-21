import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';
import { createEmptyReport, finalizeReport } from '../../../report/extractionReport';

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular routing extraction (Step 12)', () => {
  it('creates AngularRoute classifiers and router dependency edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-angular-route-'));

    // Minimal Angular decorator stubs (no Angular dependency).
    write(
      path.join(dir, 'src', 'ng.ts'),
      `export function Component(_: any){ return (t:any)=>t; }
export function NgModule(_: any){ return (t:any)=>t; }
export function Injectable(_: any){ return (t:any)=>t; }
export function Input(_: any){ return (t:any,p:any)=>{}; }
export function Output(_: any){ return (t:any,p:any)=>{}; }
export class EventEmitter<T>{}
`,
    );

    // Minimal RouterModule stubs.
    write(
      path.join(dir, 'src', 'router.ts'),
      `export type Routes = any;
export class RouterModule {
  static forRoot(r: any){ return r; }
  static forChild(r: any){ return r; }
}
`,
    );

    write(
      path.join(dir, 'src', 'a.ts'),
      `import { Component } from './ng';
@Component({ selector: 'app-a' })
export class A {}
`,
    );

    write(
      path.join(dir, 'src', 'lazy.ts'),
      `import { NgModule } from './ng';
@NgModule({})
export class LazyModule {}
`,
    );

    write(
      path.join(dir, 'src', 'app.module.ts'),
      `import { NgModule } from './ng';
import { RouterModule, Routes } from './router';
import { A } from './a';

export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'lazy', loadChildren: () => import('./lazy').then(m => m.LazyModule) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
})
export class AppModule {}
`,
    );

    write(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            jsx: 'react-jsx',
            baseUrl: '.',
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      angular: true,
      includeFrameworkEdges: true,
      includeDeps: true,
      report,
    });
    finalizeReport(report, report.startedAtIso);

    const routeClasses = model.classifiers.filter((c) => (c.stereotypes ?? []).some((s) => s.name === 'AngularRoute'));
    expect(routeClasses.length).toBeGreaterThanOrEqual(2);

    const routeA = routeClasses.find((c) => (c.taggedValues ?? []).some((tv) => tv.key === 'angular.routePath' && tv.value === 'a'));
    const routeLazy = routeClasses.find((c) => (c.taggedValues ?? []).some((tv) => tv.key === 'angular.routePath' && tv.value === 'lazy'));
    expect(routeA).toBeTruthy();
    expect(routeLazy).toBeTruthy();

    const a = model.classifiers.find((c) => c.name === 'A');
    const lazyMod = model.classifiers.find((c) => c.name === 'LazyModule');
    expect(a).toBeTruthy();
    expect(lazyMod).toBeTruthy();

    const rels = model.relations ?? [];
    const hasRouteATarget = rels.some(
      (r) => r.kind === 'DEPENDENCY' && r.sourceId === routeA!.id && r.targetId === a!.id && (r.taggedValues ?? []).some((tv) => tv.key === 'origin' && tv.value === 'router'),
    );
    expect(hasRouteATarget).toBe(true);

    const hasLazyTarget = rels.some(
      (r) =>
        r.kind === 'DEPENDENCY' &&
        r.sourceId === routeLazy!.id &&
        r.targetId === lazyMod!.id &&
        (r.taggedValues ?? []).some((tv) => tv.key === 'role' && tv.value === 'loadChildren'),
    );
    expect(hasLazyTarget).toBe(true);
  });
});
