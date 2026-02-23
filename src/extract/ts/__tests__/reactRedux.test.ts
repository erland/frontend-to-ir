import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('React Redux-like extraction (Step 7)', () => {
  test('indexes createSlice reducers as actions and adds useSelector/dispatch edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-redux-'));

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
      path.join(dir, 'src', 'state.ts'),
      `
export const createSlice = (a: any) => a;
export const createSelector = (..._a: any[]) => ({} as any);

export const userSlice = createSlice({
  name: 'users',
  reducers: {
    addUser(state: any, action: any) { return { ...state, action }; },
  },
});

export const selectUsers = createSelector(() => null);
`
    );

    writeFile(
      path.join(dir, 'src', 'app.tsx'),
      `
export const useSelector = (s: any) => s;
export function App() {
  useSelector(selectUsers);
  dispatch(addUser({ name: 'x' }));
  return <div/>;
}
`
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

    const sel = model.classifiers.find((c) => c.name === 'selectUsers' && (c.stereotypes ?? []).some((s) => s.name === 'ReduxSelector'));
    const act = model.classifiers.find((c) => c.name === 'users/addUser' && (c.stereotypes ?? []).some((s) => s.name === 'ReduxAction'));

    expect(sel).toBeTruthy();
    expect(act).toBeTruthy();

    const rels = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY' && r.sourceId === app!.id);
    expect(rels.some((r) => r.targetId === sel!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'selects'))).toBe(true);
    expect(rels.some((r) => r.targetId === act!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'dispatches'))).toBe(true);
  });
});
