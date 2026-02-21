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
