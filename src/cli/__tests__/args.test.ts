import { parseCliArgs } from '../args';

describe('parseCliArgs', () => {
  it('parses source/out/verbose', () => {
    const args = parseCliArgs(['--source', 'demo', '--out', 'out.json', '--verbose']);
    expect(args).toEqual({ source: 'demo', out: 'out.json', verbose: true });
  });

  it('handles short flags', () => {
    const args = parseCliArgs(['-s', 'x', '-o', 'y']);
    expect(args.source).toBe('x');
    expect(args.out).toBe('y');
    expect(args.verbose).toBe(false);
  });
});
