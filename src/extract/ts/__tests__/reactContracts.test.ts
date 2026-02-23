import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('React contracts (Step 9)', () => {
  test('creates a ReactContract classifier and exposes edge with props type and events', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-contract-'));

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            strict: true,
            noEmit: true,
            jsx: 'react-jsx',
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    );

    writeFile(
      path.join(dir, 'src', 'types.ts'),
      `export type Props = { title: string; onSave: (id: string) => void; onClose?: () => void };`,
    );

    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `import type { Props } from './types';
       export function App(_props: Props) { return <div/>; }`,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      includeFrameworkEdges: true,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
      react: true,
    });

    const app = model.classifiers.find((c) => c.name === 'App');
    expect(app).toBeTruthy();

    const contract = model.classifiers.find((c) => (c.stereotypes ?? []).some((s) => s.name === 'ReactContract') && c.name === 'AppContract');
    expect(contract).toBeTruthy();

    const rels = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY' && r.sourceId === app!.id);
    expect(rels.some((r) => r.targetId === contract!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'exposes'))).toBe(true);

    // props type tag exists either on classifier or relation
    expect(
      (contract!.taggedValues ?? []).some((t) => t.key === 'react.propsType' && t.value.includes('Props')) ||
        rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'react.propsType' && t.value.includes('Props'))),
    ).toBe(true);

    // events are stored as JSON string tag on contract
    const ev = (contract!.taggedValues ?? []).find((t) => t.key === 'react.events')?.value ?? '';
    expect(ev.includes('onSave')).toBe(true);
    expect(ev.includes('onClose')).toBe(true);
  });
});
