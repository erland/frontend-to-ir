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

  test('extracts props/state types for React components', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step9-'));

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
      `
export type Props = { title: string };
export type State = { count: number };
`,
    );

    writeFile(
      path.join(dir, 'src', 'Func.tsx'),
      `
import type { Props } from './types';
export function Func(props: Props) {
  return <div>{props.title}</div>;
}
`,
    );

    writeFile(
      path.join(dir, 'src', 'Fc.tsx'),
      `
import React from 'react';
import type { Props } from './types';
export const Fc: React.FC<Props> = (p) => <span>{p.title}</span>;
`,
    );

    writeFile(
      path.join(dir, 'src', 'Cls.tsx'),
      `
import React from 'react';
import type { Props, State } from './types';
export class Cls extends React.Component<Props, State> {
  render() { return <div/>; }
}
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, react: true });

    const tv = (c: any, k: string) => (c.taggedValues ?? []).find((x: any) => x.key === k)?.value;
    const attr = (c: any, n: string) => (c.attributes ?? []).find((a: any) => a.name === n);

    const func = model.classifiers.find((c) => c.name === 'Func')!;
    const fc = model.classifiers.find((c) => c.name === 'Fc')!;
    const cls = model.classifiers.find((c) => c.name === 'Cls')!;

    expect(func.kind).toBe('COMPONENT');
    expect(fc.kind).toBe('COMPONENT');
    expect(cls.kind).toBe('COMPONENT');

    expect(tv(func, 'react.propsType')).toContain('Props');
    expect(tv(fc, 'react.propsType')).toContain('Props');
    expect(tv(cls, 'react.propsType')).toContain('Props');
    expect(tv(cls, 'react.stateType')).toContain('State');

    expect(attr(func, 'props')).toBeTruthy();
    expect(attr(func, 'props')!.type.kind).toBeTruthy();

    expect(attr(cls, 'state')).toBeTruthy();
  });

  test('models React contexts and adds DI edges for useContext and Provider', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-step10-'));

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
      path.join(dir, 'src', 'ctx.tsx'),
      `
import React, { createContext, useContext } from 'react';

export type Ctx = { userId: string };
export const UserContext = createContext<Ctx>({ userId: '' });

export function Consumer() {
  const ctx = useContext(UserContext);
  return <div>{ctx.userId}</div>;
}

export function Provider() {
  return (
    <UserContext.Provider value={{ userId: '1' }}>
      <Consumer />
    </UserContext.Provider>
  );
}
`,
    );

    const model = await extractTypeScriptStructuralModel({ projectRoot: dir, react: true, includeFrameworkEdges: true });

    const ctxClassifier = model.classifiers.find((c) => c.name === 'UserContext');
    expect(ctxClassifier).toBeTruthy();
    expect(ctxClassifier!.kind).toBe('SERVICE');
    expect(ctxClassifier!.stereotypes?.map((s) => s.name)).toEqual(expect.arrayContaining(['ReactContext']));
    const tv = (c: any, k: string) => (c.taggedValues ?? []).find((x: any) => x.key === k)?.value;
    expect(tv(ctxClassifier, 'react.contextType')).toContain('Ctx');

    const consumer = model.classifiers.find((c) => c.name === 'Consumer')!;
    const provider = model.classifiers.find((c) => c.name === 'Provider')!;
    expect(consumer.kind).toBe('COMPONENT');
    expect(provider.kind).toBe('COMPONENT');

    const di = (model.relations ?? []).filter((r) => r.kind === 'DI');
    const hasUseContext = di.some(
      (r) =>
        r.sourceId === consumer.id &&
        r.targetId === ctxClassifier!.id &&
        (r.taggedValues ?? []).some((t) => t.key === 'origin' && t.value === 'useContext'),
    );
    const hasProvider = di.some(
      (r) =>
        r.sourceId === provider.id &&
        r.targetId === ctxClassifier!.id &&
        (r.taggedValues ?? []).some((t) => t.key === 'origin' && t.value === 'provider'),
    );

    expect(hasUseContext).toBe(true);
    expect(hasProvider).toBe(true);
  });

});
