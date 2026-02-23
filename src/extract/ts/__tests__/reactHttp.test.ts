import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('React HTTP extraction (Step 6)', () => {
  test('extracts fetch/axios calls inside components', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-http-react-'));

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
      path.join(dir, 'src', 'app.tsx'),
      `
const axios: any = { post: (..._a: any[]) => null };

export function App() {
  fetch('/api/a');
  fetch('/api/b', { method: 'POST' });
  axios.post('/api/c', { ok: true });
  return <div/>;
}
`,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
includeFrameworkEdges: true,
      react: true,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
    });

    const app = model.classifiers.find((c) => c.name === 'App');
    expect(app).toBeTruthy();

    const rels = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY' && r.sourceId === app!.id);
    expect(rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'http.url' && t.value === '/api/a'))).toBe(true);
    expect(rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'http.url' && t.value === '/api/b') && (r.taggedValues ?? []).some((t) => t.key === 'http.method' && t.value === 'POST'))).toBe(true);
    expect(rels.some((r) => (r.taggedValues ?? []).some((t) => t.key === 'http.url' && t.value === '/api/c') && (r.taggedValues ?? []).some((t) => t.key === 'http.client' && t.value === 'axios'))).toBe(true);
  });
});
