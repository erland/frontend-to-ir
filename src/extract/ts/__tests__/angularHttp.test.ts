import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptStructuralModel } from '../tsExtractor';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('Angular HTTP extraction (Step 6)', () => {
  test('extracts HttpClient calls as endpoint classifiers and dependency edges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-http-ng-'));

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
      path.join(dir, 'src', 'api.service.ts'),
      `
const Injectable = () => (t: any) => t;

class HttpClient {
  get(url: string) { return url; }
  post(url: string, body: any) { return body; }
  request(method: string, url: string) { return method + url; }
}

@Injectable()
export class ApiService {
  constructor(private http: HttpClient) {}
  load() { return this.http.get('/api/foo'); }
  save(id: string) { return this.http.post(\`/api/\${id}\`, { ok: true }); }
  putX() { const M = 'PUT'; return this.http.request(M, '/api/x'); }
}
`,
    );

    const model = await extractTypeScriptStructuralModel({
      projectRoot: dir,
includeFrameworkEdges: true,
      angular: true,
      includeDeps: false,
      includeTests: false,
      excludeGlobs: [],
    });

    const svc = model.classifiers.find((c) => c.name === 'ApiService');
    expect(svc).toBeTruthy();

    const endpoints = model.classifiers.filter((c) => (c.stereotypes ?? []).some((s) => s.name === 'HttpEndpoint'));
    expect(endpoints.length).toBeGreaterThanOrEqual(2);

    const rels = (model.relations ?? []).filter((r) => r.kind === 'DEPENDENCY');
    const hasFoo = rels.some((r) => r.sourceId === svc!.id && (r.taggedValues ?? []).some((t) => t.key === 'http.url' && t.value === '/api/foo'));
    expect(hasFoo).toBe(true);

    const hasPut = rels.some((r) => r.sourceId === svc!.id && (r.taggedValues ?? []).some((t) => t.key === 'http.method' && t.value === 'PUT') && (r.taggedValues ?? []).some((t) => t.key === 'http.url' && t.value === '/api/x'));
    expect(hasPut).toBe(true);
  });
});
