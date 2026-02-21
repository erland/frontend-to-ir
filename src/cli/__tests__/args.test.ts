import { parseCliArgs } from '../args';

describe('parseCliArgs', () => {
  it('parses project/out/verbose', () => {
    const args = parseCliArgs(['--project', 'demo', '--out', 'out.json', '--verbose']);
    expect(args).toEqual({ project: 'demo', out: 'out.json', verbose: true });
  });

  it('handles short flags', () => {
    const args = parseCliArgs(['-p', 'x', '-o', 'y']);
    expect(args.project).toBe('x');
    expect(args.out).toBe('y');
    expect(args.verbose).toBe(false);
  });
});
