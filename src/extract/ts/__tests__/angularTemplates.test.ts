import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular template coupling (Step 8)', () => {
  test('extracts pipe/directive/component usage from templateUrl', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-tpl-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            strict: true,
            noEmit: true,
            experimentalDecorators: true,
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    writeFile(
      path.join(dir, 'src', 'decorators.ts'),
      `export const Component = (_a: any) => (t: any) => t;
       export const Directive = (_a: any) => (t: any) => t;
       export const Pipe = (_a: any) => (t: any) => t;`,
    );

    writeFile(
      path.join(dir, 'src', 'child.ts'),
      `import { Component } from './decorators';
       @Component({ selector: 'app-child' })
       export class Child {}`,
    );

    writeFile(
      path.join(dir, 'src', 'dir.ts'),
      `import { Directive } from './decorators';
       @Directive({ selector: '[appDir]' })
       export class AppDir {}`,
    );

    writeFile(
      path.join(dir, 'src', 'pipe.ts'),
      `import { Pipe } from './decorators';
       @Pipe({ name: 'myPipe' })
       export class MyPipe {}`,
    );

    writeFile(
      path.join(dir, 'src', 'cmp.html'),
      `<div>
         <app-child></app-child>
         <div [appDir]="x"></div>
         {{ value | myPipe }}
       </div>`,
    );

    writeFile(
      path.join(dir, 'src', 'cmp.ts'),
      `import { Component } from './decorators';
       @Component({ selector: 'app-cmp', templateUrl: './cmp.html' })
       export class Cmp { value = 1; }`,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      includeFrameworkEdges: true,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
      angular: true,
    });

    const cmp = model.classifiers.find((c) => c.name === 'Cmp');
    expect(cmp).toBeTruthy();

    const rels = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY' && r.sourceId === cmp!.id);

    // component usage
    expect(
      rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'template.refKind' && t.value === 'element') && (r.taggedValues ?? []).some((t) => t.key === 'template.refName' && t.value === 'app-child')),
    ).toBe(true);

    // directive usage
    expect(
      rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'template.refKind' && t.value === 'attr') && (r.taggedValues ?? []).some((t) => t.key === 'template.refName' && t.value === 'appDir')),
    ).toBe(true);

    // pipe usage
    expect(
      rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'template.refKind' && t.value === 'pipe') && (r.taggedValues ?? []).some((t) => t.key === 'template.refName' && t.value === 'myPipe')),
    ).toBe(true);
  });
});
