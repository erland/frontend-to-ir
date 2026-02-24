/**
 * Shared routing normalization helpers.
 *
 * IMPORTANT: These helpers are intentionally conservative to avoid changing observable output.
 * They provide a single place to evolve path/segment normalization rules later.
 */

/**
 * Normalize a single route path string as found in source code.
 *
 * Current behavior is intentionally identity-preserving (except for `undefined` which callers handle).
 */
export function normalizeRoutePath(routePath: string): string {
  return routePath;
}

/**
 * Join route path segments without introducing duplicate slashes.
 * This is currently a simple, conservative join; callers should still decide
 * whether a leading slash is desired.
 */
export function joinRouteSegments(...segments: string[]): string {
  const parts = segments
    .filter((s) => s != null)
    .map((s) => String(s))
    .filter((s) => s.length > 0);

  if (parts.length === 0) return '';
  // Avoid node/path dependency; keep simple and platform-independent.
  return parts
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}
