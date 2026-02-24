# IR stereotype contract (schema v2)

This document describes how **any IR producer** can emit stereotypes in a way that downstream tools (e.g. `java-to-xmi`)
can materialize UML stereotypes **without hardcoded per-producer mappings**.

The normative schema is: `src/ir/schema/ir-schema-v2.json`.

## Core idea

IR schema v2 adds:

- `IrModel.stereotypeDefinitions[]`: a registry of stereotype definitions (id, name, where it applies, optional properties)
- `*.stereotypeRefs[]`: references from IR elements to the registry (by id), with optional values

This repo emits a **v2-only JSON payload** and strips the legacy field `*.stereotypes[]` **at serialization time**.

Legacy field `*.stereotypes[]` (name/qualifiedName) may still be present in intermediate in-memory models, but **new producers should prefer**
`stereotypeDefinitions + stereotypeRefs`.

## Required invariants

### 1) Stable stereotype ids

`IrStereotypeRef.stereotypeId` MUST reference an entry in `IrModel.stereotypeDefinitions[].id`.

The id format used by this repo is:

`st:<namespace>.<localName>`

Examples:
- `st:react.ReactComponent`
- `st:angular.Component`
- `st:generic.SourceFile`

Rules used by this repo are documented in `docs/stereotype-id-strategy.md`.
Other producers may choose a different strategy, but the key requirement is **stability**:
once published, keep the same id across runs and versions.

### 2) Deterministic ordering

For deterministic output (and stable downstream processing):

- Sort `stereotypeDefinitions` by `id`
- Sort each `stereotypeRefs` array by `stereotypeId`

This repo enforces determinism in `src/ir/canonicalizeIrModel.ts`.

### 3) Applies-to metaclasses

Each `IrStereotypeDefinition.appliesTo` MUST list UML metaclass names where the stereotype can be applied.

Typical values:
- `Class`, `Interface`, `Enumeration`
- `Property`
- `Operation`
- `Dependency`, `Association`
- `Generalization`, `InterfaceRealization`

This repo’s mapping for emitted stereotypes is implemented in `src/ir/stereotypes/appliesTo.ts`.

### 4) Framework tagging

Producers SHOULD set a tagged value:
- `framework=<lowercase-name>` (e.g. `react`, `angular`)

This is not required for v2, but strongly recommended to aid namespacing, debugging, and filtering.

See `docs/tagged-values-conventions.md`.

## Registry definition structure

Each `IrStereotypeDefinition`:

- `id`: stable identifier (referenced by refs)
- `name`: UML stereotype name
- `qualifiedName` (optional): e.g. `Frontend::Component`
- `profileName` (optional): used to group stereotypes (e.g. `Frontend`, `react`, `angular`)
- `appliesTo` (optional but recommended): UML metaclass names
- `properties` (optional): typed property definitions

### Properties (tagged values on the stereotype)

`properties[]` allows producers to define a typed set of properties:

- `name`: property name
- `type`: `string | boolean | integer | number`
- `isMulti`: whether multiple values are allowed

`IrStereotypeRef.values` may provide property values (reserved for future typed injection).
If you do not need properties today, emit `properties: []` and omit `values` (or use `{}`).

## Examples

### Minimal registry + ref on a classifier

```json
{
  "schemaVersion": "1.0",
  "stereotypeDefinitions": [
    {
      "id": "st:react.ReactComponent",
      "name": "ReactComponent",
      "profileName": "react",
      "qualifiedName": null,
      "appliesTo": ["Class"],
      "properties": []
    }
  ],
  "classifiers": [
    {
      "id": "c:App",
      "name": "App",
      "qualifiedName": "App",
      "packageId": null,
      "kind": "COMPONENT",
      "visibility": "PUBLIC",
      "attributes": [],
      "operations": [],
      "stereotypeRefs": [
        { "stereotypeId": "st:react.ReactComponent", "values": {} }
      ],
      "stereotypes": [
        { "name": "ReactComponent", "qualifiedName": null }
      ],
      "taggedValues": [
        { "key": "framework", "value": "react" }
      ],
      "source": null
    }
  ],
  "relations": [],
  "packages": [],
  "taggedValues": []
}
```

### Adding a new stereotype (no downstream code changes)

To introduce a new stereotype in any producer:

1. Choose a stable `id` (e.g. `st:angular.Directive`)
2. Add a `stereotypeDefinitions[]` entry with `name` and `appliesTo`
3. Add `stereotypeRefs[]` on the relevant IR elements

Downstream tools that implement schema v2 can now materialize the stereotype in UML without a hardcoded mapping.

## Compatibility guidance

- If you need to support older consumers, keep emitting legacy `*.stereotypes[]` in parallel.
- If you control all consumers and they support v2, you can omit legacy `*.stereotypes[]`.
