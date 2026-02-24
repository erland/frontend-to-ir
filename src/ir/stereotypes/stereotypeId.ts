import type { IrStereotype } from '../irV1';

/**
 * Stable stereotype id strategy (IR v2).
 *
 * Goal:
 * - deterministic across runs
 * - namespace separation to avoid collisions between producers/frameworks
 * - compatible with java-to-xmi examples (e.g. st:react.ReactComponent)
 *
 * Format:
 *   st:<namespace>.<localName>
 *
 * where:
 * - namespace is lowercased and sanitized (defaults to "generic")
 * - localName is taken from stereotype.name (or last segment of qualifiedName) and sanitized
 *
 * Notes:
 * - The id is intended to be *stable*. Avoid changing it once published.
 * - If you rename a stereotype but want continuity, keep emitting the same id.
 */
export type StereotypeIdParts = {
  namespace: string; // lowercased
  localName: string; // sanitized, case-preserving
};

export function sanitizeNamespace(ns: string): string {
  const n = (ns ?? '').trim().toLowerCase();
  return (n || 'generic').replace(/[^a-z0-9_.-]/g, '_');
}

export function sanitizeLocalName(name: string): string {
  const n = (name ?? '').trim();
  return (n || 'Stereotype').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function deriveParts(framework: string | null, s: IrStereotype): StereotypeIdParts {
  const qn = (s.qualifiedName ?? '').trim();
  const nsFromQn = qn.includes('::') ? qn.split('::')[0] : '';
  const namespace = sanitizeNamespace((framework ?? nsFromQn) || 'generic');

  const localFromQn = qn.includes('::') ? qn.split('::').slice(-1)[0] : '';
  const localName = sanitizeLocalName(s.name || localFromQn || 'Stereotype');

  return { namespace, localName };
}

export function stableStereotypeId(framework: string | null, s: IrStereotype): string {
  const { namespace, localName } = deriveParts(framework, s);
  return `st:${namespace}.${localName}`;
}
