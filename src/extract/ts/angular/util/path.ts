import path from 'node:path';

export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}
