# Functional specification — TypeScript/JavaScript/React/Angular → IR JSON (v1)

## 1. Purpose

The tool shall analyze a source repository containing TypeScript/JavaScript code (optionally React and/or Angular) and produce a **language-agnostic IR JSON** (IR v1) describing:

- Structural types (classes/interfaces/enums/type aliases) and their members
- Operations/functions and their signatures (best-effort for JS)
- Relationships (inheritance, implementation, associations, dependencies)
- Framework-specific relationships:
  - React: component composition (**RENDER**)
  - Angular: dependency injection (**DI**) and module composition (dependencies)
- Deterministic output suitable for version control and golden testing

The emitted IR JSON shall be consumable by a separate emitter (e.g., `java-to-xmi`) to generate UML/XMI.

## 2. Definitions

### 2.1 IR v1 (output format)

The tool outputs JSON conforming to an **IR v1 schema** equivalent to:

- `IrModel { schemaVersion, packages[], classifiers[], relations[], taggedValues[] }`
- `IrClassifier { id, name, qualifiedName, packageId, kind, visibility, attributes[], operations[], stereotypes[], taggedValues[], source }`
- `IrRelation { id, kind, sourceId, targetId, name?, stereotypes[], taggedValues[], source? }`
- `IrTypeRef` describing types (primitive, named, generic, array, union/intersection, unknown)

Framework conventions are expressed via:
- `stereotypes[]` (e.g., `ReactComponent`, `Component`, `Injectable`, `NgModule`)
- `taggedValues[]` (e.g., `framework=react`, `react.componentKind=function`, `angular.selector=...`)
- relation kinds like `RENDER`, `DI`, `TEMPLATE_USES`, `ROUTE_TO`

**Important:** The schema must remain stable; future extensions must be backward-compatible (new optional tags/stereotypes/relations rather than breaking field changes).

### 2.2 Project “source root”

The `--source` directory is the root folder for analysis. The tool will attempt to locate TS/JS configuration files such as:
- `tsconfig.json` (TypeScript)
- `package.json` (workspace detection)
- `angular.json` (Angular projects)

## 3. User-facing functionality

### 3.1 CLI

The tool shall provide a CLI executable (Node.js) with:

**Required:**
- `--source <path>`: root directory to analyze
- `--out <file>`: output IR JSON file path

**Optional:**
- `--framework <auto|react|angular|none>`: analysis emphasis; default `auto`
- `--exclude <glob>`: repeatable path excludes, evaluated against paths relative to `--source`
- `--include-tests <bool>`: whether to include test folders; default `false`
- `--deps <mode>`: include dependency relations beyond structural associations (imports, usage); default `false`
- `--include-framework-edges <bool>`: include React RENDER / Angular DI edges; default `true`
- `--report <file>`: optional Markdown report path
- `--fail-on-unresolved <bool>`: nonzero exit if unresolved symbols exceed 0; default `false`
- `--max-files <n>`: safety cap for huge repos; default no cap
- `--tsconfig <path>`: explicit tsconfig selection (overrides auto)

Exit codes:
- `0`: success
- `1`: invalid args
- `2`: analysis failure (parse/config)
- `3`: unresolved symbols present AND `--fail-on-unresolved=true`

### 3.2 Deterministic output

The tool shall guarantee deterministic IR JSON output given the same inputs:
- Stable ordering of arrays (packages, classifiers, attributes, operations, relations, stereotypes, taggedValues)
- Stable IDs based on predictable keys (qualified names, file paths)
- No timestamps or machine-specific absolute paths in output (paths should be relative to `--source`)

### 3.3 Supported languages and features

#### TypeScript
- Parse using TypeScript compiler API with full typechecker when possible
- Extract:
  - classes, interfaces, enums, type aliases
  - properties/fields and their type refs
  - methods/functions and signature type refs
  - inheritance/implements
  - import/export-based dependencies
- Relationship extraction:
  - **ASSOCIATION** from property/field type refs when the target is another known classifier
  - **DEPENDENCY** from imports and type usages (when enabled)

#### JavaScript
- Parse JS (and JSX) with TypeScript compiler in `allowJs` mode or Babel parser (implementation choice).
- Without type info, produce best-effort:
  - functions, classes
  - dependencies from imports/requires
  - types as `unknown` or `named` where resolvable (JSDoc/typescript inference if available)

#### React
Detection:
- Function components: exported function returning JSX or containing JSX in return
- Class components: extends `React.Component` / `Component`
Output:
- Classifier kind: `COMPONENT`
- Stereotype: `ReactComponent`
- Tags:
  - `framework=react`
  - `react.componentKind=function|class`
  - optional: `react.hooks=[useState,useEffect,...]` (string list encoding)

Relations:
- **RENDER**: component A renders component B when JSX contains `<B .../>` and `B` resolves to a component classifier
- TaggedValue on relation: `origin=jsx`

#### Angular
Detection:
- Decorators:
  - `@Component` → classifier kind `COMPONENT`, stereotype `Component`
  - `@Injectable` → classifier kind `SERVICE`, stereotype `Injectable`
  - `@NgModule` → classifier kind `MODULE`, stereotype `NgModule`
- Tags:
  - `framework=angular`
  - `angular.selector`, `angular.templateUrl`, `angular.styleUrls` (optional)
  - `angular.moduleName` (optional)

Relations:
- **DI**: component/service constructor parameter type resolves to a service classifier (tag `origin=constructor`)
- **DEPENDENCY**: module imports/exports/declarations relationships (as dependencies with tags like `origin=ngmodule`)
- Optional **TEMPLATE_USES**: template references to component selectors (if template parsing implemented)
- Optional **ROUTE_TO**: Angular router configuration references to components

### 3.4 Unresolved symbols and external references

The tool shall track:
- External type references (symbols outside analyzed set)
- Unresolved symbols (unable to resolve even as external)
These should appear in the report and optionally in IR via taggedValues:
- classifier-level or model-level tagged values like `unresolved.count`
- relation suppression: do not emit relations that reference unknown target IDs

### 3.5 Report (optional)

If `--report` is supplied, write a Markdown report including:
- Project summary (files analyzed, TS/JS split)
- Classifiers counts by kind (CLASS/INTERFACE/COMPONENT/SERVICE/MODULE/…)
- Relation counts by kind (ASSOCIATION/DEPENDENCY/RENDER/DI/…)
- Unresolved/external counts + top unresolved symbols
- Notes on limitations (JS typing, dynamic patterns)

## 4. Data model details

### 4.1 IDs

IDs must be stable and deterministic.

Recommended conventions:
- classifier id: `c:<qualifiedName>` (or `c:<fileRelPath>#<exportName>` when needed)
- attribute id: `a:<classifierName>.<attrName>`
- operation id: `m:<classifierName>.<opName>(<paramTypes>)` (signature in ID only if overloads exist)
- relation id: `r:<kind>:<sourceId>-><targetId>[:<name>]`

### 4.2 Packages

Packages may be:
- derived from folder structure (`src/app/...` → package segments) OR
- omitted entirely (packageId null) for MVP

Packages are optional in IR v1; do not require them for first release.

### 4.3 Type references

TypeRef mapping:
- primitives: `string|number|boolean|void|any|unknown|never|null|undefined`
- named: fully-qualified when resolvable, else best-effort name
- generics: `Array<T>` / `Promise<T>` etc → GENERIC with args
- arrays: `T[]` → ARRAY with elementType
- unions/intersections: `A | B`, `A & B` → UNION/INTERSECTION (best-effort; may flatten to NAMED string in MVP)

## 5. Quality requirements

- Deterministic output must be enforced via tests (golden fixtures).
- Performance: must handle medium projects (5k–20k TS LOC) on a developer machine.
- Fail safely: timeouts/caps for huge repos and `node_modules` exclusion by default.
- Clear error messages and exit codes.

## 6. Test strategy (finished tool)

- Unit tests for:
  - ID generation
  - type ref conversion
  - React component detection
  - Angular decorator/DI extraction
- Integration tests with fixtures:
  - minimal TS project
  - minimal React project
  - minimal Angular project
- Golden IR snapshots: verify stable JSON output.
