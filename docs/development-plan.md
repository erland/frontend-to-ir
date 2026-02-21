# Development plan — TypeScript/JavaScript/React/Angular → IR JSON (v1)

This plan is intentionally structured so **each step can be implemented in a single prompt** by an LLM and produces a runnable repo after every step.

> Assumption: This repo is separate from `java-to-xmi`. We will copy the IR schema/conventions docs (or include them directly) so this repo can be developed independently.

---

## Step 1 — Scaffold the repository (Node + TypeScript CLI + tests)

**Goal:** Create a working TypeScript CLI project with lint/test/build.

**Tasks:**
- Initialize Node project (`package.json`)
- Add TypeScript config, build scripts
- Add a CLI entrypoint `src/cli.ts` with minimal arg parsing (no framework logic yet)
- Add test framework (Vitest or Jest) + one smoke test
- Add `docs/` folder and copy `functional-specification.md` + `development-plan.md`

**Exit criteria:**
- `npm test` passes
- `npm run build` produces `dist/`
- `node dist/cli.js --help` works

---

## Step 2 — Add IR v1 types and JSON writer (deterministic output)

**Goal:** Implement IR v1 TypeScript interfaces mirroring the Java IR, plus deterministic JSON output.

**Tasks:**
- Add `src/ir/` with TS types:
  - `IrModel`, `IrClassifier`, `IrRelation`, `IrTypeRef`, etc.
- Add `src/ir/normalize.ts` to sort arrays deterministically
- Add `src/ir/write.ts` to write pretty JSON with stable ordering and newline
- Add `src/ir/schema/ir-schema-v1.json` (copy from java-to-xmi) + a tiny validator (Ajv) in tests

**Exit criteria:**
- A unit test writes an example IR and matches a golden fixture exactly

---

## Step 3 — Project scanning + excludes (file inventory)

**Goal:** Build deterministic file discovery that supports TS/JS/TSX/JSX and excludes.

**Tasks:**
- Implement `src/scan/sourceScanner.ts`:
  - input: `sourceRoot`, `excludeGlobs[]`, `includeTests`
  - output: sorted list of file paths relative to `sourceRoot`
- Default excludes: `**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/.next/**` etc
- Add tests for scanning determinism and exclude behavior

**Exit criteria:**
- Scanning returns stable sorted lists across runs
- Excludes behave as specified

---

## Step 4 — TypeScript extraction (structural model)

**Goal:** Extract a structural model from TS projects using the TypeScript compiler API.

**Tasks:**
- Implement `src/extract/ts/tsProgram.ts`:
  - load `tsconfig.json` (auto-detect; allow `--tsconfig`)
  - create `Program` and `TypeChecker`
- Implement `src/extract/ts/tsExtractor.ts`:
  - walk source files; collect exported classifiers
  - extract:
    - classes/interfaces/enums/type aliases
    - fields/properties types
    - methods/functions signatures
    - extends/implements relations
  - type ref conversion: `ts.Type` → `IrTypeRef`
- Wire CLI: `code-to-ir --source --out` writes IR
- Add integration fixture: `fixtures/ts-mini/` and golden `fixtures/ts-mini/model.ir.json`

**Exit criteria:**
- TS mini fixture generates IR matching golden output
- Determinism test passes

---

## Step 5 — React extraction (component detection + RENDER edges)

**Goal:** Add React-specific heuristics without breaking generic TS extraction.

**Tasks:**
- Implement `src/extract/react/reactDetector.ts`:
  - detect function components (name capitalized + returns JSX OR contains JSX)
  - detect class components (extends React.Component or Component)
- Emit:
  - classifier kind `COMPONENT`
  - stereotype `ReactComponent`
  - tags `framework=react`, `react.componentKind=function|class`
  - optional hooks tag by scanning call expressions `useX(...)`
- Implement `src/extract/react/renderGraph.ts`:
  - find JSX elements `<X />` and resolve `X` to a classifier
  - emit `RENDER` relations with tag `origin=jsx`
- Add fixture `fixtures/react-mini/` + golden IR

**Exit criteria:**
- React mini fixture produces IR with component stereotypes and RENDER edges
- Output is deterministic

---

## Step 6 — Angular extraction (decorators + DI edges + module dependencies)

**Goal:** Add Angular detection and DI graph extraction.

**Tasks:**
- Implement `src/extract/angular/angularDetector.ts`:
  - detect `@Component`, `@Injectable`, `@NgModule` decorators
  - extract basic decorator metadata into tags (selector, templateUrl)
- Implement `src/extract/angular/diGraph.ts`:
  - constructor parameters → resolve type → emit `DI` relation (`origin=constructor`)
- Implement `src/extract/angular/ngModuleGraph.ts`:
  - parse `imports`, `providers`, `declarations` arrays → emit `DEPENDENCY` relations with tags (`origin=ngmodule`, `role=imports|providers|declarations`)
- Add fixture `fixtures/angular-mini/` + golden IR

**Exit criteria:**
- Angular mini fixture produces IR with stereotypes and DI edges
- Output is deterministic

---

## Step 7 — JavaScript support (allowJs + import graph, best-effort types)

**Goal:** Support JS/JSX projects where TS type info is limited.

**Tasks:**
- Enable `allowJs` program creation when no tsconfig is found (or when JS files exist)
- Extract:
  - classes and functions
  - import/require dependencies
  - best-effort type refs (unknown where missing)
- Add fixture `fixtures/js-mini/` + golden IR

**Exit criteria:**
- JS mini fixture produces IR deterministically
- CLI prints a clear note in report about limited type accuracy

---

## Step 8 — UX polish: report, unresolved tracking, and CLI completeness

**Goal:** Finish user-facing behavior as per functional spec.

**Tasks:**
- Add unresolved/external symbol tracking
- Implement `--report` Markdown output
- Implement `--fail-on-unresolved`, `--max-files`, `--framework`, `--include-deps`, `--include-framework-edges`
- Add end-to-end tests for flags

**Exit criteria:**
- Functional spec features are implemented
- `npm run test` covers all fixtures and flags

---

## Notes for continuing in a fresh chat

To resume implementation later without prior context, provide:
- The IR v1 JSON schema (`src/ir/schema/ir-schema-v1.json`) and examples
- The CLI contract (flags and exit codes)
- The golden fixture strategy and determinism rules
- The mapping rules for React and Angular (stereotypes, tags, relation kinds)
