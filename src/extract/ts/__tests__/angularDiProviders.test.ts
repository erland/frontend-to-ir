import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular DI providers + injection edges (Step 1)', () => {
  test('extracts providers registrations, @Inject tokens, and inject() calls as DI edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-di-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            strict: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: false,
            noEmit: true,
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    // Minimal decorator declarations so we don't need Angular as a dependency.
    writeFile(
      path.join(dir, 'src', 'ng.ts'),
      `
export function Component(_meta: any) { return function (_ctor: any) {}; }
export function Injectable(_meta?: any) { return function (_ctor: any) {}; }
export function NgModule(_meta: any) { return function (_ctor: any) {}; }
export function Inject(_token: any) { return function (_proto: any, _name: any, _idx: any) {}; }
export function inject<T>(_token: any): T { return (null as any) as T; }
`,
    );

    writeFile(
      path.join(dir, 'src', 'my.service.ts'),
      `
import { Injectable } from './ng';
@Injectable()
export class MyService { ping(): string { return 'ok'; } }
`,
    );

    writeFile(
      path.join(dir, 'src', 'alt.service.ts'),
      `
import { Injectable } from './ng';
@Injectable()
export class AltService { }
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.component.ts'),
      `
import { Component, Inject, inject } from './ng';
import { MyService } from './my.service';

@Component({
  selector: 'app-root',
  providers: [MyService, { provide: MyService, useClass: MyService }]
})
export class AppComponent {
  private svc2 = inject(MyService);

  constructor(@Inject(MyService) _svc: any) {}
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.module.ts'),
      `
import { NgModule } from './ng';
import { AppComponent } from './app.component';
import { MyService } from './my.service';
import { AltService } from './alt.service';

@NgModule({
  declarations: [AppComponent],
  providers: [MyService, { provide: AltService, useClass: MyService }]
})
export class AppModule {}
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, angular: true });

    const comp = model.classifiers.find((c) => c.name === 'AppComponent')!;
    const mod = model.classifiers.find((c) => c.name === 'AppModule')!;
    const svc = model.classifiers.find((c) => c.name === 'MyService')!;
    const alt = model.classifiers.find((c) => c.name === 'AltService')!;

    const rels = model.relations ?? [];

    const providerEdge = (fromId: string, toId: string, scope: string) =>
      rels.find(
        (r) =>
          r.kind === 'DI' &&
          r.sourceId === fromId &&
          r.targetId === toId &&
          r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'provider') &&
          r.taggedValues?.some((t) => t.key === 'role' && t.value === 'providers') &&
          r.taggedValues?.some((t) => t.key === 'scope' && t.value === scope),
      );

    expect(providerEdge(mod.id, svc.id, 'ngmodule')).toBeTruthy();
    expect(providerEdge(comp.id, svc.id, 'component')).toBeTruthy();

    // provider object (provide AltService, useClass MyService) should create edge from module to MyService
    const po = rels.find(
      (r) =>
        r.kind === 'DI' &&
        r.sourceId === mod.id &&
        r.targetId === svc.id &&
        r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'provider') &&
        r.taggedValues?.some((t) => t.key === 'provide' && t.value === 'AltService') &&
        r.taggedValues?.some((t) => t.key === 'useClass' && t.value === 'MyService'),
    );
    expect(po).toBeTruthy();

    // @Inject token should produce DI edge
    const inj = rels.find(
      (r) =>
        r.kind === 'DI' &&
        r.sourceId === comp.id &&
        r.targetId === svc.id &&
        r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'constructor') &&
        r.taggedValues?.some((t) => t.key === 'token' && t.value === 'MyService'),
    );
    expect(inj).toBeTruthy();

    // inject() call should produce DI edge
    const injFn = rels.find(
      (r) =>
        r.kind === 'DI' &&
        r.sourceId === comp.id &&
        r.targetId === svc.id &&
        r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'injectFn') &&
        r.taggedValues?.some((t) => t.key === 'token' && t.value === 'MyService'),
    );
    expect(injFn).toBeTruthy();

    // Ensure AltService exists (used only as provide token in provider object)
    expect(alt).toBeTruthy();
  });
});
