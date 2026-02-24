import { joinRouteSegments, normalizeRoutePath } from '../extract/ts/routing';

describe('routing normalization helpers', () => {
  it('normalizeRoutePath is identity-preserving (guardrail)', () => {
    expect(normalizeRoutePath('a')).toBe('a');
    expect(normalizeRoutePath('/a/b')).toBe('/a/b');
    expect(normalizeRoutePath('')).toBe('');
  });

  it('joinRouteSegments joins without introducing duplicate slashes', () => {
    expect(joinRouteSegments('/a/', 'b/', '/c')).toBe('a/b/c');
    expect(joinRouteSegments('a', '', 'b')).toBe('a/b');
    expect(joinRouteSegments('/', '/')).toBe('');
  });
});
