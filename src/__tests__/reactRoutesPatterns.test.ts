import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrClassifier, IrRelation } from '../ir/irV1';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hasStereo(c: IrClassifier, name: string): boolean {
  return (c.stereotypes ?? []).some((s) => s.name === name);
}

function tagValue(r: IrRelation, key: string): string | undefined {
  return (r.taggedValues ?? []).find((t) => t.key === key)?.value;
}

describe('React routes patterns (refactor guardrails)', () => {
  test('supports JSX <Route> and createBrowserRouter([...]) routes', async () => {
    const dir = makeTempProject('f2ir-react-routes-');

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
        },
        include: ['src/**/*'],
      }),
    );

    // Minimal shims
    writeFile(
      path.join(dir, 'src', 'types.d.ts'),
      `
      declare module 'react' {
        export type FC<P = {}> = (props: P) => any;
      }
      declare namespace JSX {
        interface IntrinsicElements {
          div: any;
          Route: any;
          Routes: any;
        }
      }
      `,
    );

    writeFile(
      path.join(dir, 'src', 'app.tsx'),
      `
      import React from 'react';

      export function Foo() { return <div/>; }
      export const Bar: React.FC = () => <div/>;

      // JSX routes
      export const jsxRoutes = (
        <Routes>
          <Route path="/a" element={<Foo/>} />
          <Route path="/parent">
            <Route index element={<Bar/>} />
          </Route>
        </Routes>
      );

      // Data routes (createBrowserRouter) - we only need the identifier in scope.
      declare function createBrowserRouter(x: any): any;
      export const router = createBrowserRouter([
        { path: "/b", element: <Bar/> },
        { path: "/c", element: <Foo/>, children: [ { index: true, element: <Bar/> } ] }
      ]);
      `,
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeFrameworkEdges: true,
      includeDeps: false,
      importGraph: false,
      react: true,
      angular: false,
      report,
    });

    const routes = model.classifiers.filter((c) => hasStereo(c, 'ReactRoute'));
    expect(routes.length).toBeGreaterThanOrEqual(4); // /a, /parent, index under /parent, /b, /c, index under /c

    const foo = model.classifiers.find((c) => hasStereo(c, 'ReactComponent') && c.name === 'Foo');
    const bar = model.classifiers.find((c) => hasStereo(c, 'ReactComponent') && c.name === 'Bar');
    expect(foo).toBeTruthy();
    expect(bar).toBeTruthy();

    const routeA = routes.find((r) => (r.taggedValues ?? []).some((t) => t.key === 'react.routePath' && t.value === '/a'));
    expect(routeA).toBeTruthy();

    // Route(/a) -> Foo should exist with role=component
    const relsFromA = (model.relations ?? []).filter((r) => r.sourceId === (routeA as any).id && r.targetId === (foo as any).id);
    expect(relsFromA.some((r) => tagValue(r, 'role') === 'component')).toBe(true);

    // Parent-child relationship should exist: Route(/parent) -> Route(index) with role=child
    const parent = routes.find((r) => (r.taggedValues ?? []).some((t) => t.key === 'react.routePath' && t.value === '/parent'));
    expect(parent).toBeTruthy();
    const childRel = (model.relations ?? []).find((r) => r.sourceId === (parent as any).id && tagValue(r, 'role') === 'child');
    expect(childRel).toBeTruthy();
  });
});
