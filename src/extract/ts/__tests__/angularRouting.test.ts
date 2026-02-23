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
      path.join(dir, 'src', 'guard.ts'),
      `import { Injectable } from './ng';
@Injectable({})
export class AuthGuard {}
`,
    );

    write(
      path.join(dir, 'src', 'resolver.ts'),
      `import { Injectable } from './ng';
@Injectable({})
export class DataResolver {}
`,
    );

    write(
      path.join(dir, 'src', 'http.ts'),
      `export const HTTP_INTERCEPTORS = 'HTTP_INTERCEPTORS';
`,
    );

    write(
      path.join(dir, 'src', 'interceptor.ts'),
      `import { Injectable } from './ng';
@Injectable({})
export class AuthInterceptor {}
`,
    );

    write(
      path.join(dir, 'src', 'app.module.ts'),
      `import { NgModule } from './ng';
import { RouterModule, Routes } from './router';
import { A } from './a';
import { AuthGuard } from './guard';
import { DataResolver } from './resolver';
import { HTTP_INTERCEPTORS } from './http';
import { AuthInterceptor } from './interceptor';

export const routes: Routes = [
  { path: 'a', component: A, canActivate: [AuthGuard], resolve: { data: DataResolver } },
  { path: 'lazy', loadChildren: () => import('./lazy').then(m => m.LazyModule) },
  { path: 'cmp', loadComponent: () => import('./a').then(m => m.A) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  providers: [{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }],
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

    const guard = model.classifiers.find((c) => c.name === 'AuthGuard');
    const resolver = model.classifiers.find((c) => c.name === 'DataResolver');
    expect(guard).toBeTruthy();
    expect(resolver).toBeTruthy();

    const routeAHasGuard = rels.some(
      (r) =>
        r.kind === 'DEPENDENCY' &&
        r.sourceId === routeA!.id &&
        r.targetId === guard!.id &&
        (r.taggedValues ?? []).some((tv) => tv.key === 'role' && tv.value === 'canActivate'),
    );
    expect(routeAHasGuard).toBe(true);

    const routeAHasResolver = rels.some(
      (r) =>
        r.kind === 'DEPENDENCY' &&
        r.sourceId === routeA!.id &&
        r.targetId === resolver!.id &&
        (r.taggedValues ?? []).some((tv) => tv.key === 'role' && tv.value === 'resolve') &&
        (r.taggedValues ?? []).some((tv) => tv.key === 'resolveKey' && tv.value === 'data'),
    );
    expect(routeAHasResolver).toBe(true);

    const routeCmp = routeClasses.find((c) => (c.taggedValues ?? []).some((tv) => tv.key === 'angular.routePath' && tv.value === 'cmp'));
    expect(routeCmp).toBeTruthy();

    const hasLoadComponent = rels.some(
      (r) =>
        r.kind === 'DEPENDENCY' &&
        r.sourceId === routeCmp!.id &&
        r.targetId === a!.id &&
        (r.taggedValues ?? []).some((tv) => tv.key === 'role' && tv.value === 'loadComponent'),
    );
    expect(hasLoadComponent).toBe(true);

    const interceptor = model.classifiers.find((c) => c.name === 'AuthInterceptor');
    expect(interceptor).toBeTruthy();
    const interceptorMarked = (interceptor!.stereotypes ?? []).some((s) => s.name === 'AngularInterceptor');
    expect(interceptorMarked).toBe(true);

  });
});
