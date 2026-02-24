# Refactoring plan guardrails

This document describes the refactoring guardrails for the TypeScript extractor implementation.

## Goals

- Reduce complexity by splitting large modules into smaller, well-named units.
- Preserve all externally visible behavior (IR output, report output, CLI behavior).
- Keep changes incremental so each refactoring step can be completed in a single prompt.

## Non-goals

- No schema changes (IR v1 remains unchanged).
- No feature changes or logic improvements unless a bug is found while refactoring.

## Safety net

- The Jest test suite must pass after every step.
- A smoke/guardrail test (`src/__tests__/extractSmoke.test.ts`) asserts stable counts and key outputs on a mixed
  TS + React + Angular fixture project.
- If a step requires updating tests, prefer adding new assertions over loosening existing ones.

## Approach

1. Move code (copy/paste) into new modules with minimal edits.
2. Export the moved functions with the same signatures.
3. Replace the old in-file implementations with imports.
4. Run tests and fix only wiring mistakes (types, imports, circular dependencies).

## Conventions introduced by the refactor

### Feature folders and stable façades

- **Routing helpers:** `src/extract/ts/routing/*`
  - Shared, semantics-neutral helpers only (string/path normalization, relation construction).

- **Structural member extraction:** `src/extract/ts/structural/members/*`
  - Split by member kind: fields, methods, accessors.

- **Angular staged pipeline:** `src/extract/ts/angular/enrich/*`
  - Each stage should be focused (DI, modules, routing, templates, state, http).

- **NgRx split:** `src/extract/ts/angular/ngrx/*`
  - `detect.ts` should not mutate IR.
  - `emit.ts` should be the only place that mutates IR for NgRx features.

- **Public API split:** `src/extract/ts/exports/publicApi/*`
  - Stages: discover → walk → emit.

- **Framework util namespaces:**
  - Angular: `src/extract/ts/angular/util/*`
  - React: `src/extract/ts/react/util/*`
  - Keep `angular/util.ts` and `react/util.ts` as **re-export façades** to avoid churn.

### Detector vs emitter rule of thumb

When a feature is heuristics-heavy (routing/state/templates), prefer the pattern:

- `detect*` functions return plain findings (ids, nodes, strings, resolved symbols).
- `emit*` functions translate findings into IR relations/classifiers and report entries.

This makes behavior changes easier to review and keeps AST traversal isolated from IR mutation.
