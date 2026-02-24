# frontend-to-ir (TypeScript/JavaScript/React/Angular → IR JSON)

This repository contains a command-line tool that analyzes **TypeScript**, **JavaScript**, **React**, and **Angular** codebases and emits a **language-agnostic IR JSON** that matches the **IR schema v2** used by `java-to-xmi` (the emitter toolchain).

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

- `model.ir.json` in IR schema v2 format:
  - `IrModel.schemaVersion = "1.0"`
  - classifiers, relations, stereotypes, taggedValues
- Optional: `extraction-report-v2` JSON with counts + findings (unresolved types/imports, etc.).

## Usage

```bash
# Install + build
npm install
npm run build

# Basic (scaffolding in Step 1; generation implemented in later steps)
frontend-to-ir --help

# Scan (file inventory)
frontend-to-ir scan --project . --out out/inventory.json

# Extract IR (choose a mode)
frontend-to-ir extract --mode ts --project . --out out/model.ir.json
frontend-to-ir extract --mode react --project . --out out/react.ir.json
frontend-to-ir extract --mode angular --project . --out out/angular.ir.json
frontend-to-ir extract --mode js --project . --out out/js.ir.json

# Optional report
frontend-to-ir extract --mode react --project . --out out/react.ir.json --report out/report.json

# Exclusions
frontend-to-ir extract --mode ts --project . --out out/model.ir.json --exclude "**/generated/**"
```

## IR compatibility

This repo targets the IR schema and conventions defined in the `java-to-xmi` project:

- `docs/ir/ir-schema-v2.json`
- `docs/ir/framework-conventions.md`

You should copy those files into this repo (or add them as a git submodule / npm package later). The development plan below describes how.

## License

Choose a license for this repo (MIT/BSD recommended if you plan broad reuse).


## IR service image (GHCR)

This repository publishes a ready-to-run HTTP service image used by `code-to-xmi-server`:

- `ghcr.io/erland/code-to-xmi-ir-service`

Endpoints:

- `GET /health`
- `POST /v2/ir` (multipart `inputZip` or `repoUrl`, plus `mode=react|angular|ts|js`)

Run it directly:

```bash
docker run --rm -p 7071:7071 ghcr.io/erland/code-to-xmi-ir-service:snapshot
```
