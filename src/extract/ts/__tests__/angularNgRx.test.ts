import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular NgRx extraction (Step 7)', () => {
  test('indexes actions/selectors/effects and adds dispatch/select/ofType edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-ngrx-'));

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
      path.join(dir, 'src', 'state.ts'),
      `
export const createAction = (..._a: any[]) => ({} as any);
export const createSelector = (..._a: any[]) => ({} as any);
export const createEffect = (fn: any) => fn;
export const ofType = (..._a: any[]) => ({} as any);

export const loadUsers = createAction('[Users] Load');
export const selectUsers = createSelector(() => null);

export const loadUsers$ = createEffect(() => ofType(loadUsers));
`
    );

    writeFile(
      path.join(dir, 'src', 'cmp.ts'),
      `
const Component = () => (t: any) => t;

class Store {
  dispatch(_a: any) {}
  select(_s: any) {}
}

@Component()
export class MyCmp {
  constructor(private store: Store) {}
  run() {
    this.store.dispatch(loadUsers());
    this.store.select(selectUsers);
  }
}
`
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      includeFrameworkEdges: true,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
      angular: true,
    });

    const cmp = model.classifiers.find((c) => c.name === 'MyCmp');
    expect(cmp).toBeTruthy();

    const action = model.classifiers.find((c) => c.name === 'loadUsers' && (c.stereotypes ?? []).some((s) => s.name === 'NgRxAction'));
    const selector = model.classifiers.find((c) => c.name === 'selectUsers' && (c.stereotypes ?? []).some((s) => s.name === 'NgRxSelector'));
    const effect = model.classifiers.find((c) => c.name === 'loadUsers$' && (c.stereotypes ?? []).some((s) => s.name === 'NgRxEffect'));

    expect(action).toBeTruthy();
    expect(selector).toBeTruthy();
    expect(effect).toBeTruthy();

    const rels = model.relations ?? [];
    expect(
      rels.some((r) => r.sourceId === cmp!.id && r.targetId === action!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'dispatches')),
    ).toBe(true);

    expect(
      rels.some((r) => r.sourceId === cmp!.id && r.targetId === selector!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'selects')),
    ).toBe(true);

    expect(
      rels.some((r) => r.sourceId === effect!.id && r.targetId === action!.id && (r.taggedValues ?? []).some((t) => t.key === 'role' && t.value === 'ofType')),
    ).toBe(true);
  });
});
