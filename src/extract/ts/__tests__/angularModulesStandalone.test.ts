import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular modules + standalone composition (Step 2)', () => {
  test('extracts NgModule exports/bootstrap and standalone component imports as dependency edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step2-'));

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
      path.join(dir, 'src', 'standalone.component.ts'),
      `
import { Component } from './ng';
import { CommonModule } from './common.module';

@Component({
  standalone: true,
  selector: 'x-standalone',
  imports: [CommonModule],
  template: '<div></div>'
})
export class StandaloneComponent {}
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.component.ts'),
      `
import { Component } from './ng';

@Component({ selector: 'app-root', template: '<x-standalone />' })
export class AppComponent {}
`,
    );

    writeFile(
      path.join(dir, 'src', 'app.module.ts'),
      `
import { NgModule } from './ng';
import { AppComponent } from './app.component';
import { StandaloneComponent } from './standalone.component';

@NgModule({
  declarations: [AppComponent],
  exports: [AppComponent],
  bootstrap: [AppComponent],
})
export class AppModule {}
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, angular: true });
    const rels = model.relations ?? [];

    const mod = model.classifiers.find((c) => c.name === 'AppModule')!;
    const app = model.classifiers.find((c) => c.name === 'AppComponent')!;
    const standalone = model.classifiers.find((c) => c.name === 'StandaloneComponent')!;
    const common = model.classifiers.find((c) => c.name === 'CommonModule')!;

    expect(mod).toBeTruthy();
    expect(app).toBeTruthy();
    expect(standalone).toBeTruthy();
    expect(common).toBeTruthy();

    const hasNgEdge = (role: string, toId: string) =>
      rels.some(
        (r) =>
          r.kind === 'DEPENDENCY' &&
          r.sourceId === mod.id &&
          r.targetId === toId &&
          r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'ngmodule') &&
          r.taggedValues?.some((t) => t.key === 'role' && t.value === role),
      );

    expect(hasNgEdge('exports', app.id)).toBe(true);
    expect(hasNgEdge('bootstrap', app.id)).toBe(true);

    const standaloneImport = rels.find(
      (r) =>
        r.kind === 'DEPENDENCY' &&
        r.sourceId === standalone.id &&
        r.targetId === common.id &&
        r.taggedValues?.some((t) => t.key === 'origin' && t.value === 'standalone') &&
        r.taggedValues?.some((t) => t.key === 'role' && t.value === 'imports'),
    );
    expect(standaloneImport).toBeTruthy();
  });
});
