import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('React conventions (Step 5)', () => {
  test('detects React components and adds RENDER edges from JSX usage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step5-'));

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
      path.join(dir, 'src', 'Button.tsx'),
      `
export function Button() {
  return <button>OK</button>;
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `
import { Button } from './Button';

export const App = () => {
  return (
    <div>
      <Button />
    </div>
  );
};
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, react: true });

    const app = model.classifiers.find((c) => c.name === 'App');
    const btn = model.classifiers.find((c) => c.name === 'Button');
    expect(app).toBeTruthy();
    expect(btn).toBeTruthy();

    expect(app!.kind).toBe('COMPONENT');
    expect(btn!.kind).toBe('COMPONENT');

    expect(app!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['ReactComponent']));
    expect(btn!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['ReactComponent']));

    const tv = (c: any, k: string) => (c.taggedValues ?? []).find((x: any) => x.key === k)?.value;
    expect(tv(app, 'framework')).toBe('react');
    expect(tv(btn, 'framework')).toBe('react');
    expect(tv(app, 'react.componentKind')).toBe('function');

    const renders = (model.relations ?? []).filter((r) => r.kind === 'RENDER');
    const hasAppToBtn = renders.some((r) => r.sourceId === app!.id && r.targetId === btn!.id);
    expect(hasAppToBtn).toBe(true);
  });
});
