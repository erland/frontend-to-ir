# Inventory of stereotypes emitted by frontend-to-ir (today)

This project currently emits stereotypes using the **legacy field**:

- `element.stereotypes: IrStereotype[]` where each stereotype is `{ name, qualifiedName? }`.

> Note: We have introduced **IR schema v2** (registry + refs) in java-to-xmi. This inventory documents what *v1-style* stereotypes are emitted today so we can map them into `stereotypeDefinitions` + `stereotypeRefs` in the next steps.

## Stereotypes by framework / feature

### React

| Stereotype | Emitted on | Where | Notes / tags |
|---|---|---|---|
| `ReactComponent` | `IrClassifier` | `src/extract/ts/react/components.ts` (via `rctx.addStereotype`) | Also sets `taggedValues`: `framework=react` and `react.componentKind` (`class`/`function`). |
| `ReactContext` | `IrClassifier` | `src/extract/ts/react/context.ts` | Sets `framework=react` and optional `react.contextType`. |
| `ReactRoute` | `IrRelation` | `src/extract/ts/react/routes.ts` | Used for route relationships; also emits route-related tagged values in the same module. |
| `ReactContract` | `IrRelation` | `src/extract/ts/react/contracts.ts` | Used for “contract” relationships; see tagged values in module. |
| `HttpEndpoint` | `IrRelation` | `src/extract/ts/react/http.ts` | Emitted for detected HTTP calls; tagged values include origin/context info. |
| `ReduxSlice` | `IrClassifier` | `src/extract/ts/react/stateRedux.ts` | Kind is `MODULE`; sets `framework=react`, `origin=state`. |
| `ReduxAction` | `IrClassifier` | `src/extract/ts/react/stateRedux.ts` | Same as above. |
| `ReduxSelector` | `IrClassifier` | `src/extract/ts/react/stateRedux.ts` | Same as above. |

React helper used:
- `src/extract/ts/react/util/stereotypes.ts` implements `addStereotype(...)` and `setClassifierTag(...)`.

### Angular

| Stereotype | Emitted on | Where | Notes / tags |
|---|---|---|---|
| `AngularRoute` | `IrRelation` | `src/extract/ts/angular/routing.ts` | Route edges; tagged values include route origin/patterns. |
| `AngularTemplateRef` | `IrRelation` | `src/extract/ts/angular/templates.ts` | Template reference edges; tagged values capture template binding context. |
| `HttpEndpoint` | `IrRelation` | `src/extract/ts/angular/http.ts` | HTTP edges; tagged values include origin/context info. |
| `NgRxAction` | `IrClassifier` | `src/extract/ts/angular/ngrx/emit.ts` | Emitted for NgRx concepts; stereotype comes from `stereotypeForKind`. |
| `NgRxSelector` | `IrClassifier` | `src/extract/ts/angular/ngrx/emit.ts` | — |
| `NgRxEffect` | `IrClassifier` | `src/extract/ts/angular/ngrx/emit.ts` | Default branch in `stereotypeForKind`. |

**Important:** Angular `Component` / `Injectable` are **not** emitted today as stereotypes; instead the extractor uses:
- classifier `kind` (e.g. `COMPONENT`, `SERVICE`)
- tagged values such as `framework=angular`, `angular.selector`, etc.

### General / structural / exports

| Stereotype | Emitted on | Where | Notes |
|---|---|---|---|
| `SourceFile` | `IrClassifier` | `src/extract/ts/structural/declareClassifiers.ts` | Represents a physical source file as a classifier (kind varies); used for structural browsing. |
| `ApiExport` | `IrRelation` | `src/extract/ts/exports/publicApi/shared.ts` | Marks relations derived from public API exports. |

## Tests / fixtures mentioning stereotypes

These are test-only:
- `src/ir/__tests__/writeIrJson.test.ts` uses `A` / `B` stereotypes for ordering/determinism assertions.
- `src/ir/__tests__/schemaValidation.test.ts` uses `Example` as a schema validation fixture.

## Quick grep commands

From repo root:

```bash
rg "stereotypes:" src
rg "addStereotype\(" src
rg "stereotypeForKind" src
```
