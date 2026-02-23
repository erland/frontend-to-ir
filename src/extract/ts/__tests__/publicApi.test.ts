import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Public API surface (Step 10)', () => {
  test('creates ApiExport classifiers and links consumers to exports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-pubapi-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            strict: true,
            noEmit: true,
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    writeFile(path.join(dir, 'src', 'lib.ts'), `export const foo = 1; export function bar() { return 2; }`);
    writeFile(path.join(dir, 'src', 'index.ts'), `export { foo, bar } from './lib';`);
    writeFile(path.join(dir, 'src', 'consumer.ts'), `import { foo } from './index'; console.log(foo);`);

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      includeFrameworkEdges: false,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
      importGraph: true,
    });

    const apiFoo = model.classifiers.find((c) => (c.stereotypes ?? []).some((s) => s.name === 'ApiExport') && c.name === 'foo');
    expect(apiFoo).toBeTruthy();

    const consumerMod = model.classifiers.find((c) => c.kind === 'MODULE' && c.name === 'consumer.ts');
    expect(consumerMod).toBeTruthy();

    const rels = model.relations ?? [];
    expect(rels.some((r) => r.sourceId === consumerMod!.id && r.targetId === apiFoo!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'imports'))).toBe(true);

    const indexMod = model.classifiers.find((c) => c.kind === 'MODULE' && c.name === 'index.ts');
    expect(indexMod).toBeTruthy();
    expect(rels.some((r) => r.sourceId === indexMod!.id && r.targetId === apiFoo!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'exports'))).toBe(true);
  });
});
