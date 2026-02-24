# Stable stereotype id strategy (IR v2)

This repo uses a stable, deterministic stereotype id format so downstream tools (e.g. `java-to-xmi`) can
apply stereotypes without custom hardcoded mappings.

## Format

`st:<namespace>.<localName>`

Examples:
- `st:react.ReactComponent`
- `st:angular.Component`
- `st:generic.SourceFile`

## How namespace is chosen

1. If the element has tagged value `framework=<value>`, use that.
2. Otherwise, if `stereotype.qualifiedName` contains `::`, use the part before `::`.
3. Otherwise, use `generic`.

Namespace is always lowercased and sanitized to `[a-z0-9_.-]` (other characters become `_`).

## How localName is chosen

1. Prefer `stereotype.name`
2. Otherwise, use the last segment of `qualifiedName` (`X::Y` → `Y`)
3. Otherwise, use `Stereotype`

Local name is sanitized to `[A-Za-z0-9_.-]` (other characters become `_`).
Case is preserved.

## Stability rule

Once you publish an id, treat it as stable. If you rename a stereotype but want continuity, keep emitting
the same `stereotypeId` value.
