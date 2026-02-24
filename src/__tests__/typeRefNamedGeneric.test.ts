import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

import { typeNodeToIrTypeRefResolved } from '../extract/ts/typeRef';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('typeRefImpl (namedGeneric) guardrails', () => {
  test('handles nested generics with union type args', () => {
    const dir = makeTempProject('f2ir-typeref-');

    writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }),
    );

    writeFile(
      path.join(dir, 'src', 'types.ts'),
      `
        export class Foo {}
        export class Bar {}
        export const v: Promise<Map<string, Foo | Bar>> = null as any;
      `,
    );

    const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) throw new Error('tsconfig not found');

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dir);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const checker = program.getTypeChecker();

    const sf = program.getSourceFiles().find((s) => s.fileName.endsWith(path.join('src', 'types.ts')));
    if (!sf) throw new Error('source file not found');

    let typeNode: ts.TypeNode | undefined;
    sf.forEachChild((node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === 'v' && decl.type) {
            typeNode = decl.type;
          }
        }
      }
    });

    if (!typeNode) throw new Error('type node not found');

    const ir = typeNodeToIrTypeRefResolved(typeNode, checker, (sym) => sym.getName());

    expect(ir.kind).toBe('GENERIC');
    expect(ir.name).toBe('Promise');
    expect(ir.typeArgs?.length).toBe(1);

    const map = ir.typeArgs?.[0]!;
    expect(map.kind).toBe('GENERIC');
    expect(map.name).toBe('Map');
    expect(map.typeArgs?.length).toBe(2);

    const k = map.typeArgs?.[0]!;
    expect(k.kind).toBe('PRIMITIVE');
    expect(k.name).toBe('string');

    const v = map.typeArgs?.[1]!;
    expect(v.kind).toBe('UNION');
    expect(v.typeArgs?.map((t) => `${t.kind}:${t.name}`).sort()).toEqual(['NAMED:Bar', 'NAMED:Foo']);
  });
});
