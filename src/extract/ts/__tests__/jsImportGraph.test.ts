import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

async function write(p: string, content: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

describe('JavaScript support (Step 7)', () => {
  test('allowJs + import graph emits file MODULEs and DEPENDENCY edges', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-to-ir-js-'));

    // A tsconfig that would normally disable JS. Step 7 must override this.
    await write(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            allowJs: false,
            checkJs: false,
          },
        },
        null,
        2,
      ),
    );

    await write(
      path.join(dir, 'util.js'),
      `export function help(x){ return x ?? 0; }\n`,
    );
    await write(
      path.join(dir, 'more.js'),
      `module.exports = { v: 1 };\n`,
    );
    await write(
      path.join(dir, 'index.js'),
      `import { help } from './util.js';\nconst m = require('./more.js');\nexport const x = help(m.v);\n`,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: 'tsconfig.json',
      excludeGlobs: [],
      includeTests: true,
      forceAllowJs: true,
      importGraph: true,
      includeDeps: true,
    });

    const fileMods = model.classifiers.filter(
      (c) => c.kind === 'MODULE' && (c.stereotypes ?? []).some((s) => s.name === 'SourceFile'),
    );
    expect(fileMods.map((m) => m.qualifiedName)).toEqual(
      expect.arrayContaining(['index.js', 'util.js', 'more.js']),
    );

    const deps = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY');
    const depTags = deps.map((d) => ({
      from: model.classifiers.find((c) => c.id === d.sourceId)?.qualifiedName,
      to: model.classifiers.find((c) => c.id === d.targetId)?.qualifiedName,
      origin: (d.taggedValues ?? []).find((tv) => tv.key === 'origin')?.value,
    }));

    expect(depTags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'index.js', to: 'util.js', origin: 'import' }),
        expect.objectContaining({ from: 'index.js', to: 'more.js', origin: 'require' }),
      ]),
    );
  });
});
