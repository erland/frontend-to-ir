# (Updated for IR schema v2)


## IR v2 fields used by this plan

- `IrModel.stereotypeDefinitions: IrStereotypeDefinition[]` (optional but recommended)
- `IrClassifier.stereotypeRefs: IrStereotypeRef[]` (optional)
- `IrAttribute.stereotypeRefs: IrStereotypeRef[]` (optional)
- `IrOperation.stereotypeRefs: IrStereotypeRef[]` (optional)
- `IrRelation.stereotypeRefs: IrStereotypeRef[]` (optional)

Legacy field `stereotypes: IrStereotype[]` may still be emitted for display/backward-compatibility, but new producers should prefer `stereotypeRefs` + `stereotypeDefinitions`.


This plan targets the **IR schema v2** contract (`docs/ir/ir-schema-v2.json`).

# Downloadable step-by-step plan: Make **frontend-to-ir** emit stereotypes in the new “registry + refs” IR format

## Goal
Modify **frontend-to-ir** so that IR outputs include:
1) a **Stereotype Registry** (definitions) that describes stereotypes (profile/name/applicability/properties), and
2) stereotype **references** on elements that point to registry entries by stable id (plus optional tagged values).

This enables java-to-xmi (once modified) to generate UML/XMI containing any newly introduced stereotypes **without requiring changes** in java-to-xmi.

## Starting state (assumed)
- Repo: `digest_frontend-to-ir.zip` (TypeScript project) with:
  - `src/ir/` holding IR types
  - `src/extract/` holding extraction logic
  - optional `services/ir-service/` exposing an HTTP API
- The IR currently includes some stereotype representation, but:
  - stereotypes may be emitted as plain strings,
  - definitions/applicability are not carried,
  - so downstream (java-to-xmi) cannot materialize unknown stereotypes.

## Assumptions (explicit)
- frontend-to-ir already categorizes elements into kinds that can map to UML metaclasses (Class/Interface/Package/Operation/Property/etc.) or can be extended to do so.
- You want deterministic IR output (stable ordering).

---

\1
Deliverable: `docs/stereotypes-inventory.md` (this repo’s current emitted stereotypes).

### Deliverables
- `docs/stereotypes-frontend-to-ir-current.md` listing:
  - each stereotype name emitted
  - which element kinds it attaches to
  - any tagged values emitted (keys + sample values)
  - any source conditions that create it (e.g., Angular @Component, React function component, etc.)

### What to do
- Search for:
  - `stereotype`, `stereotypes`, `tagged`, `annotations`
- Add a small diagnostic mode if helpful (optional):
  - run extraction and print unique stereotypes and their attachment targets

### Verification
- Run your existing CLI on a sample repo and confirm the list matches output.

---

## Step 2 — Extend IR types in frontend-to-ir to include stereotype registry + refs
### Deliverables
- IR type additions (in `src/ir/`):
  - `IrStereotypeDefinition`
  - `IrStereotypePropertyDefinition` (optional but recommended)
  - `IrStereotypeRef`
- Extend IR root model type to include:
  - `stereotypeDefinitions: IrStereotypeDefinition[]`

### Recommended minimal types
**IrStereotypeDefinition**
- `id: string` (stable)
- `name: string`
- `profileName?: string`
- `appliesTo: string[]` (UML metaclass names)
- `properties?: { name: string; type: "string"|"boolean"|"integer"|"number"; isMulti?: boolean }[]`

**IrStereotypeRef**
- `stereotypeId: string`
- `values?: Record<string, any>`

### Backward compatibility option
If other consumers still expect the old format:
- keep old `element.stereotypeRefs (legacy IrStereotype[])?: string[]` temporarily
- but prefer the new `element.stereotypeRefs: IrStereotypeRef[]`

### Verification
- TypeScript build:
  - `npm test` (if present)
  - `npm run build`

---

## Step 3 — Introduce a Stereotype Registry builder in the extraction pipeline
### Deliverables
- A new registry module (example):
  - `src/ir/stereotypes/registry.ts`
- API like:
  - `registerStereotype(def: IrStereotypeDefinition): string` (returns id)
  - `getDefinitions(): IrStereotypeDefinition[]`
- The extractor uses registry to attach stereotypes by id.

### What to do
1. During extraction, instantiate a registry.
2. When extraction detects a stereotype condition:
   - call `registerStereotype({ ... })` (id stable; see Step 4)
   - attach `{ stereotypeId, values }` on element
3. At the end, set:
   - `irModel.stereotypeDefinitions = registry.getDefinitions()`

### Determinism rules
- Registry stores definitions keyed by id (Map).
- `getDefinitions()` returns definitions sorted by `profileName`, then `id`.

### Verification
- Golden IR snapshot test (Step 7) should be stable across runs.

---

\1
Deliverables:
- `src/ir/stereotypes/stereotypeId.ts` (stable id strategy)
- `docs/stereotype-id-strategy.md`

### Deliverables
- A documented id convention in `docs/ir-stereotypes-contract.md` (or similar)
- Implementation in registry module.

### Recommended convention
- `id = "st:" + <profileNameLower> + "." + <stereotypeName>`  
  Examples:
  - `st:frontend.Component`
  - `st:react.FunctionComponent`
  - `st:angular.Injectable`

If you anticipate collisions or want strict stability:
- include a namespace segment:
  - `st:frontend-to-ir/angular.Component`

### Verification
- Test that repeated extraction on same input yields identical ids.

---

## Step 5 — Map frontend element kinds to UML metaclass names (appliesTo)
### Deliverables
- A single mapping module:
  - `src/ir/stereotypes/appliesTo.ts`

### What to do
Define what UML metaclass each extracted element kind corresponds to:
- Module / package-like -> `"Package"`
- Component / class-like -> `"Class"` (or `"Component"` concept but UML metaclass is Class)
- Interface-like -> `"Interface"`
- Method-like -> `"Operation"`
- Field/attribute-like -> `"Property"`
- Parameter-like -> `"Parameter"`
- Dependency/usage -> `"Dependency"`

Then for each stereotype you emit, set:
- `appliesTo` accordingly (often a single entry; sometimes multiple).

### Verification
- Unit tests:
  - `@Component` stereotype applies to `Class`
  - `@Injectable` applies to `Class`
  - `Hook` applies to `Operation` (if you model it that way), etc.

---

\1
Deliverables:
- `src/ir/taggedValues.ts` (shared tagged value helpers)
- `docs/tagged-values-conventions.md`

### Deliverables
- A tagged value schema for stereotypes that carry extra data (selector, route, hook name, file path, etc.)
- Implementation in extraction:
  - attach `values` under `IrStereotypeRef`

### What to do
For any stereotype that emits values:
1. Define properties in the stereotype definition:
   - `{ name: "selector", type: "string" }`
2. On the element’s stereotype ref:
   - `values: { selector: "app-root" }`

### Determinism rules
- Sort keys in `values` before serialization (or use a stable stringify helper).

### Verification
- Golden IR test verifies stable JSON ordering.

---

\1
Deliverables:
- `src/ir/__tests__/goldenIrV2Snapshot.test.ts`
- `src/ir/__tests__/__fixtures__/golden_ir_v2_stereotypes.json`

### Deliverables
- One or more fixtures repos under `src/test/fixtures/` (or your existing pattern).
- Golden output file:
  - `src/test/golden/angular-react-stereotypes.ir.json`
- Tests:
  - run extraction and compare output JSON (after stable normalization).

### What to test
- Registry exists and includes expected stereotype definitions.
- Elements contain stereotype refs with correct ids.
- Tagged values are present and correct (where relevant).
- Output is deterministic.

### Verification
- `npm test`

---

## Step 8 — Update ir-service output (if you expose HTTP API)
### Deliverables
- Ensure the HTTP endpoint returns the new IR fields.
- If you version APIs:
  - optionally add `schemaVersion` bump.

### Verification
- Run service locally and confirm response includes `stereotypeDefinitions`.

---

\1
Deliverable:
- `docs/ir-stereotype-contract.md` (normative contract for third-party IR producers)

### Deliverables
- `docs/ir-stereotypes-contract.md` covering:
  - `stereotypeDefinitions` format
  - `stereotypes` refs format
  - id conventions
  - supported UML metaclass names in `appliesTo`
  - tagged value typing expectations

---

## Verification commands (typical)
- `npm ci`
- `npm run build`
- `npm test`
- CLI run:
  - `node dist/cli.js --framework react --source <repo> --out <outdir>`

---

## Expected outcome
After implementing this plan:
- frontend-to-ir emits IR that is self-describing for stereotypes.
- Adding a new stereotype later only requires:
  - registering a new `IrStereotypeDefinition` in frontend-to-ir extraction logic
  - applying it via `IrStereotypeRef`
- java-to-xmi (once upgraded) can generate UML/XMI that includes it automatically.


## Additional alignment step

- Copy `docs/ir/ir-schema-v2.json` into `src/ir/schema/ir-schema-v2.json` and use it as the reference schema for validation/tests.
