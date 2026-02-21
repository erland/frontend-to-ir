import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { typeNodeToIrTypeRef, typeToIrTypeRef } from '../typeRef';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fti-typeref-'));
}

function buildProgram(file: string) {
  const program = ts.createProgram({
    rootNames: [file],
    options: { noEmit: true, strict: true, target: ts.ScriptTarget.ES2020 },
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error('Missing source file');
  return { checker, sf };
}

describe('typeRef', () => {
  test('maps unions/intersections/arrays/generics best-effort', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(
      file,
      [
        'export type U = string | number;',
        'export type I = {a:string} & {b:number};',
        'export type Arr = Foo[];',
        'export interface Foo { x: string }',
        'export type G = Promise<Foo>;',
      ].join('\n'),
      'utf8',
    );

    const { checker, sf } = buildProgram(file);

    const typeAliases = sf.statements.filter(ts.isTypeAliasDeclaration);
    const byName = new Map(typeAliases.map((d) => [d.name.text, d]));

    const u = typeNodeToIrTypeRef(byName.get('U')!.type, checker);
    expect(u.kind).toBe('UNION');
    expect(u.typeArgs?.length).toBe(2);

    const i = typeNodeToIrTypeRef(byName.get('I')!.type, checker);
    expect(i.kind).toBe('INTERSECTION');

    const arr = typeNodeToIrTypeRef(byName.get('Arr')!.type, checker);
    expect(arr.kind).toBe('ARRAY');
    expect(arr.elementType?.kind).toBe('NAMED');

    const g = typeNodeToIrTypeRef(byName.get('G')!.type, checker);
    expect(['GENERIC', 'NAMED']).toContain(g.kind);
    if (g.kind === 'GENERIC') {
      expect(g.typeArgs?.[0].kind).toBe('NAMED');
    }
  });

  test('preserves unresolved reference names from TypeNode', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'b.ts');
    fs.writeFileSync(file, 'export interface A { b: MissingType }', 'utf8');

    const { checker, sf } = buildProgram(file);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const prop = iface.members.find(ts.isPropertySignature)!;
    const tn = prop.type!;

    const ir = typeNodeToIrTypeRef(tn, checker);
    expect(ir.kind).toBe('NAMED');
    expect(ir.name).toBe('MissingType');
  });

  test('typeToIrTypeRef handles literal unions as UNION of primitives', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'c.ts');
    fs.writeFileSync(file, "export type L = 'a' | 'b';", 'utf8');

    const { checker, sf } = buildProgram(file);
    const alias = sf.statements.find(ts.isTypeAliasDeclaration)!;
    const t = checker.getTypeFromTypeNode(alias.type);
    const ir = typeToIrTypeRef(t, checker);

    expect(ir.kind).toBe('UNION');
    expect(ir.typeArgs?.every((x: any) => x.kind === 'PRIMITIVE' && x.name === 'string')).toBe(true);
  });
});
