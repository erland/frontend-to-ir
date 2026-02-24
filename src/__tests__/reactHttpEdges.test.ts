import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractTypeScriptStructuralModel } from '../extract/ts/tsExtractor';
import { createEmptyReport } from '../report/extractionReport';
import type { IrClassifier, IrModel, IrTaggedValue } from '../ir/irV1';

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

describe('React HTTP enrichment (refactor guardrails)', () => {
  test('emits HttpEndpoint classifiers and DEPENDENCY edges for fetch/axios', async () => {
    const dir = makeTempProject('f2ir-react-http-');

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

    // Minimal type shims so TS program can be created without installed deps.
    writeFile(
      path.join(dir, 'src', 'types.d.ts'),
      `
      declare module 'react' {
        export type FC<P = {}> = (props: P) => any;
        export const useEffect: any;
      }
      declare module 'axios' {
        type Axios = { get: (url: string) => any; create: (...args: any[]) => Axios };
        const axios: Axios;
        export default axios;
      }
      `,
    );

    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `
      import React from 'react';
      import axios from 'axios';

      export const App: React.FC = () => {
        fetch('/api/hello');
        axios.get('/api/users');
        return <div>Hello</div>;
      };
      `,
    );

    const report = createEmptyReport({ toolName: 'frontend-to-ir', toolVersion: 'test', projectRoot: dir });
    const model: IrModel = await extractTypeScriptStructuralModel({
      projectRoot: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      includeFrameworkEdges: true,
      react: true,
      report,
    });

    const endpoints: IrClassifier[] = model.classifiers.filter((c: IrClassifier) => hasStereo(c, 'HttpEndpoint'));
    expect(endpoints.length).toBeGreaterThanOrEqual(2);

    // Ensure framework tag exists
    for (const e of endpoints) {
      const tv: IrTaggedValue[] = e.taggedValues ?? [];
      expect(tv.some((t) => t.key === 'framework' && t.value === 'react')).toBe(true);
      expect(tv.some((t) => t.key === 'http.method')).toBe(true);
      expect(tv.some((t) => t.key === 'http.url')).toBe(true);
    }

    const endpointIds = new Set(endpoints.map((e) => e.id));
    const byId = new Map(model.classifiers.map((c) => [c.id, c]));

    const depToEndpoint = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY' && endpointIds.has(r.targetId));
    expect(depToEndpoint.length).toBeGreaterThanOrEqual(2);

    // Source should be a ReactComponent classifier (caller)
    for (const rel of depToEndpoint) {
      const src = byId.get(rel.sourceId);
      expect(src).toBeTruthy();
      expect(hasStereo(src!, 'ReactComponent')).toBe(true);
    }
  });
});
