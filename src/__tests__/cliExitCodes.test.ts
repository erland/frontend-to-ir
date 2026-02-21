import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runExtract } from '../cli';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('CLI exit codes (spec alignment)', () => {
  test('returns exit code 3 when --fail-on-unresolved=true and unresolved findings exist (even without --report)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2ir-exit3-'));

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

    // MissingCtx is never defined; this should trigger an unresolvedContext finding.
    writeFile(
      path.join(dir, 'src', 'App.tsx'),
      `
import { useContext } from 'react';

export function App() {
  const v = useContext(MissingCtx);
  return <div>{String(v)}</div>;
}
`,
    );

    const out = path.join(dir, 'out.json');

    const code = await runExtract({
      source: dir,
      out,
      framework: 'react',
      exclude: [],
      includeTests: false,
      includeDeps: false,
      includeFrameworkEdges: true,
      report: undefined,
      failOnUnresolved: true,
      maxFiles: undefined,
      tsconfig: undefined,
      verbose: false,
    });

    expect(code).toBe(3);
    expect(fs.existsSync(out)).toBe(true);
  });
});
