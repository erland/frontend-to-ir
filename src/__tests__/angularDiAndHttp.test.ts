import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrClassifier, IrModel } from '../ir/irV1';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hasStereo(c: IrClassifier, name: string): boolean {
  return (c.stereotypes ?? []).some((s) => s.name === name);
}

describe('Angular DI + HTTP enrichment (refactor guardrails)', () => {
  test('emits DI edges and HttpEndpoint classifiers', async () => {
    const dir = makeTempProject('f2ir-angular-di-http-');

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          experimentalDecorators: true,
        },
        include: ['src/**/*'],
      }),
    );

    // Minimal shims for Angular decorators + HttpClient
    writeFile(
      path.join(dir, 'src', 'types.d.ts'),
      `
      declare module '@angular/core' {
        export function Component(meta: any): any;
        export function Injectable(meta?: any): any;
        export function Inject(token: any): any;
        export function Optional(): any;
      }
      declare module '@angular/common/http' {
        export class HttpClient {
          get<T>(url: string): any;
          post<T>(url: string, body: any): any;
          request<T>(method: string, url: string): any;
        }
        export const HTTP_INTERCEPTORS: any;
      }
      `,
    );

    writeFile(
      path.join(dir, 'src', 'service.ts'),
      `
      import { Injectable } from '@angular/core';

      @Injectable()
      export class MyService {
        ping() { return 'ok'; }
      }
      `,
    );

    writeFile(
      path.join(dir, 'src', 'app.component.ts'),
      `
      import { Component } from '@angular/core';
      import { HttpClient } from '@angular/common/http';
      import { MyService } from './service';

      @Component({ selector: 'app-root', template: '<div></div>' })
      export class AppComponent {
        constructor(private svc: MyService, private http: HttpClient) {
          this.http.get('/api/hello');
        }
        go() { this.svc.ping(); }
      }
      `,
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model: IrModel = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeFrameworkEdges: true,
      angular: true,
      report,
    });

    const byName = new Map(model.classifiers.map((c) => [c.name, c]));
    const app = byName.get('AppComponent');
    const svc = byName.get('MyService');
    expect(app).toBeTruthy();
    expect(svc).toBeTruthy();
    expect(hasStereo(app!, 'AngularComponent')).toBe(true);
    expect(hasStereo(svc!, 'AngularInjectable')).toBe(true);

    // DI relation from component to service
    const diEdges = (model.relations ?? []).filter((r) => r.kind === 'DI' && r.sourceId === app!.id && r.targetId === svc!.id);
    expect(diEdges.length).toBeGreaterThanOrEqual(1);

    // HttpEndpoint classifier + dependency to it
    const endpoints = model.classifiers.filter(
      (c) =>
        hasStereo(c, 'HttpEndpoint') &&
        (c.taggedValues ?? []).some((t) => t.key === 'framework' && t.value === 'angular'),
    );
    expect(endpoints.length).toBeGreaterThanOrEqual(1);

    const endpointIds = new Set(endpoints.map((e) => e.id));
    const depToEndpoint = (model.relations ?? []).filter(
      (r) => r.kind === 'DEPENDENCY' && r.sourceId === app!.id && endpointIds.has(r.targetId),
    );
    expect(depToEndpoint.length).toBeGreaterThanOrEqual(1);
  });
});
