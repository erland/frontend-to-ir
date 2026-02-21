import crypto from 'node:crypto';

/** Stable short id from an arbitrary string. */
export function hashId(prefix: string, value: string): string {
  const h = crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 16);
  return `${prefix}${h}`;
}

/** Normalize to posix-style path separators. */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}
