import fs from 'fs';
import path from 'path';
import os from 'os';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

describe('Extractor smoke (refactor guardrail)', () => {
  it('produces stable counts for a mixed TS + React + Angular fixture', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-smoke-'));

    // tsconfig enabling decorators and JSX
    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'CommonJS',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            jsx: 'react-jsx',
            experimentalDecorators: true,
          },
          include: ['src/**/*'],
        },
        null,
        2
      )
    );

    // minimal React stubs (enough for type-checker + JSX)
    writeFile(
      path.join(dir, 'src', 'react.ts'),
      `
export type ReactNode = any;
export type FC<P = {}> = (props: P) => ReactNode;
export class Component<P = {}, S = {}> { constructor(props: P) {} }
export function createContext<T>(value: T) { return { Provider: (p: any) => null, _t: value } as any; }
export function useContext<T>(ctx: any): T { return ctx._t as T; }
`
    );

    // Angular decorator stubs
    writeFile(
      path.join(dir, 'src', 'ng.ts'),
      `
export function Component(_x: any) { return (t: any) => t; }
export function Injectable(_x?: any) { return (t: any) => t; }
export function NgModule(_x: any) { return (t: any) => t; }
export function Input(_alias?: string) { return (_t: any, _p: any, _d?: any) => {}; }
export function Output(_alias?: string) { return (_t: any, _p: any, _d?: any) => {}; }
export class EventEmitter<T = any> { emit(_x: T): void {} }
`
    );

    // Angular router stub
    writeFile(
      path.join(dir, 'src', 'router.ts'),
      `
export type Routes = any[];
export class RouterModule {
  static forRoot(_x: any) { return {}; }
  static forChild(_x: any) { return {}; }
}
`
    );

    // React fixture: context + props + render edge
    writeFile(
      path.join(dir, 'src', 'reactApp.tsx'),
      `
import { createContext, useContext, FC } from './react';

export type ButtonProps = { label: string };

export const Button: FC<ButtonProps> = (props) => <span>{props.label}</span>;

export type CtxType = { user: string };
export const UserCtx = createContext<CtxType>({ user: 'x' });

export const App = () => {
  const ctx = useContext(UserCtx);
  return (
    <div>
      <Button label={ctx.user} />
      <UserCtx.Provider value={ctx}></UserCtx.Provider>
    </div>
  );
};
`
    );

    // Angular fixture: component with @Input/@Output and routing
    writeFile(
      path.join(dir, 'src', 'angular.ts'),
      `
import { Component, NgModule, Input, Output, EventEmitter } from './ng';
import { RouterModule } from './router';

export class Payload { x!: string; }

@Component({ selector: 'app-a', template: '<div></div>' })
export class A {
  @Input() title!: string;
  @Output() changed = new EventEmitter<Payload>();
}

@NgModule({
  imports: [RouterModule.forRoot([{ path: 'a', component: A }])]
})
export class AppModule {}
`
    );
    // Extra routing call to ensure route extraction finds RouterModule.forRoot in a top-level statement
    writeFile(
      path.join(dir, 'src', 'routesCall.ts'),
      `
import { RouterModule } from './router';
import { A } from './angular';
RouterModule.forRoot([{ path: 'a', component: A }]);
`
    );


    const report = createEmptyReport({
      toolName: 'frontend-to-ir',
      toolVersion: 'test',
      projectRoot: dir,
      startedAtIso: '2000-01-01T00:00:00.000Z',
    });
    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeTests: false,
      includeDeps: true,
      includeFrameworkEdges: true,
      react: true,
      angular: true,
      importGraph: true,
      report,
    });

    const classifierKinds: Record<string, number> = {};
    for (const c of model.classifiers) classifierKinds[c.kind] = (classifierKinds[c.kind] ?? 0) + 1;

    const relationKinds: Record<string, number> = {};
    for (const r of model.relations ?? []) relationKinds[r.kind] = (relationKinds[r.kind] ?? 0) + 1;

    const findingsByKind: Record<string, number> = {};
    for (const f of report.findings) findingsByKind[f.kind] = (findingsByKind[f.kind] ?? 0) + 1;

    // Guardrails:
    // 1) Determinism: two runs should produce identical IR JSON (stable IDs + canonicalization).
    // 2) Sanity: React and Angular artifacts are present.
    const { serializeIrJson } = await import('../ir/writeIrJson');
    const report2 = createEmptyReport({
      toolName: 'frontend-to-ir',
      toolVersion: 'test',
      projectRoot: dir,
      startedAtIso: '2000-01-01T00:00:00.000Z',
    });
    const model2 = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeTests: false,
      includeDeps: true,
      includeFrameworkEdges: true,
      react: true,
      angular: true,
      importGraph: true,
      report: report2,
    });

    expect(serializeIrJson(model)).toEqual(serializeIrJson(model2));

    expect(Boolean(model.classifiers.find((c) => c.name === 'App' && c.kind === 'COMPONENT'))).toBe(true);
    expect(Boolean(model.classifiers.find((c) => c.stereotypes?.some((s) => s.name === 'AngularComponent')))).toBe(true);

    // At least one React RENDER edge and at least one dependency edge should exist.
    expect((relationKinds.RENDER ?? 0)).toBeGreaterThan(0);
    expect((relationKinds.DEPENDENCY ?? 0)).toBeGreaterThan(0);
  });
});