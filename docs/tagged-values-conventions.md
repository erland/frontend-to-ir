# Tagged values conventions

This repo emits tagged values (`taggedValues: [{ key, value }]`) to provide tool-neutral metadata.

## Required keys

- `framework`: lowercased framework identifier (e.g. `react`, `angular`)

## Recommended conventions

- Namespace framework-specific keys using `<framework>.` prefix:
  - `react.componentKind`
  - `angular.selector`
  - `angular.templateUrl`
- Use `origin` to describe how a relation/edge was detected (e.g. `jsx`, `constructor`, `http`, …).

## Determinism

Output is canonicalized so tagged values are sorted by `(key, value)`. Producers should still avoid
creating duplicate keys with conflicting values; prefer upsert semantics.
