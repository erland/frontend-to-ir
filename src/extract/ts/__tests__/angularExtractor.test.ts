import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular conventions (Step 6)', () => {
  test('detects Angular decorators and adds DI + NgModule dependency edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step6-'));

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
`,
    );

    writeFile(
      path.join(dir, 'src', 'common.module.ts'),
      `
export class CommonModule {}
`,
    );

    writeFile(
      path.join(dir, 'src', 'my.service.ts'),
      `
import { Injectable } from './ng';

@Injectable()
export class MyService {
  ping(): string { return 'ok'; }
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.component.ts'),
      `
import { Component } from './ng';
import { MyService } from './my.service';

@Component({ selector: 'app-root', templateUrl: './app.component.html' })
export class AppComponent {
  constructor(private svc: MyService) {}
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.module.ts'),
      `
import { NgModule } from './ng';
import { AppComponent } from './app.component';
import { MyService } from './my.service';
import { CommonModule } from './common.module';

@NgModule({
  imports: [CommonModule],
  declarations: [AppComponent],
  providers: [MyService]
})
export class AppModule {}
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, angular: true });

    const app = model.classifiers.find((c) => c.name === 'AppComponent');
    const svc = model.classifiers.find((c) => c.name === 'MyService');
    const mod = model.classifiers.find((c) => c.name === 'AppModule');
    const common = model.classifiers.find((c) => c.name === 'CommonModule');

    expect(app).toBeTruthy();
    expect(svc).toBeTruthy();
    expect(mod).toBeTruthy();
    expect(common).toBeTruthy();

    expect(app!.kind).toBe('COMPONENT');
    expect(svc!.kind).toBe('SERVICE');
    expect(mod!.kind).toBe('MODULE');

    expect(app!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['AngularComponent']));
    expect(svc!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['AngularInjectable']));
    expect(mod!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['AngularNgModule']));

    const tags = (cName: string) =>
      model.classifiers
        .find((c) => c.name === cName)
        ?.taggedValues?.reduce<Record<string, string>>((acc, tv) => {
          acc[tv.key] = tv.value;
          return acc;
        }, {}) ?? {};

    expect(tags('AppComponent').framework).toBe('angular');
    expect(tags('AppComponent')['angular.selector']).toBe('app-root');
    expect(tags('AppComponent')['angular.templateUrl']).toBe('./app.component.html');

    const rels = model.relations ?? [];
    const di = rels.find((r) => r.kind === 'DI' && r.sourceId === app!.id && r.targetId === svc!.id);
    expect(di).toBeTruthy();
    expect(di!.taggedValues?.find((t) => t.key === 'origin')?.value).toBe('constructor');

    const dep = (role: string, toName: string) => {
      const to = model.classifiers.find((c) => c.name === toName)!
      return rels.find(
        (r) =>
          r.kind === 'DEPENDENCY' &&
          r.sourceId === mod!.id &&
          r.targetId === to.id &&
          r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'ngmodule') &&
          r.taggedValues?.some((t) => t.key === 'role' && t.value === role),
      );
    };

    expect(dep('imports', 'CommonModule')).toBeTruthy();
    expect(dep('declarations', 'AppComponent')).toBeTruthy();
    expect(dep('providers', 'MyService')).toBeTruthy();
  });
});
