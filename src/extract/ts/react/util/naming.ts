export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}
