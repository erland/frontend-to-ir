# frontend-to-ir (TypeScript/JavaScript/React/Angular → IR JSON)

This repository contains a command-line tool that analyzes **TypeScript**, **JavaScript**, **React**, and **Angular** codebases and emits a **language-agnostic IR JSON** that matches the **IR v1** used by `java-to-xmi` (the emitter toolchain).

The IR output is designed to be consumed by a separate emitter (e.g., your `java-to-xmi` multi-module build) to produce UML/XMI.

## Goals

- Parse and analyze TS/JS projects (including monorepos/workspaces where feasible).
- Extract a **structural model** (classes/interfaces/type aliases/enums, functions, members).
- Extract **framework graphs**:
  - React component detection + **RENDER** (component composition) relations.
  - Angular decorator detection + DI graph (**DI** relations), module graphs (**DEPENDENCY**), and optional template usage (**TEMPLATE_USES**) when available.
- Emit **deterministic** IR JSON (stable ordering, stable IDs).
- Provide a human-readable Markdown report (optional).

## Non-goals (initially)

- Perfect type inference for plain JavaScript without type information.
- Full runtime behavior analysis, data flow, or precise call graphs.
- Complete Angular template semantic extraction (bindings, pipes, directive resolution) beyond basic component usage (optional later).

## Output

- `model.ir.json` in IR v1 format:
  - `IrModel.schemaVersion = "1.0"`
  - classifiers, relations, stereotypes, taggedValues
- Optional: `report.md` with summary stats and limitations.

## Usage (planned)

```bash
# Install + build
npm install
npm run build

# Basic (scaffolding in Step 1; generation implemented in later steps)
frontend-to-ir --help

# Planned usage (later steps)
frontend-to-ir scan --project . --out out/model.ir.json

# React emphasis (still works without this if autodetected)
frontend-to-ir scan --project . --out out/react.ir.json

# Angular emphasis
frontend-to-ir scan --project . --out out/angular.ir.json

# Include dependencies and JSX/template edges
frontend-to-ir scan --project . --out out/model.ir.json

# Exclusions
frontend-to-ir scan --project . --out out/model.ir.json
```

## IR compatibility

This repo targets the IR schema and conventions defined in the `java-to-xmi` project:

- `docs/ir/ir-schema-v1.json`
- `docs/ir/framework-conventions.md`

You should copy those files into this repo (or add them as a git submodule / npm package later). The development plan below describes how.

## License

Choose a license for this repo (MIT/BSD recommended if you plan broad reuse).
