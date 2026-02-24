# ir-service

HTTP wrapper around the `frontend-to-ir` CLI.

## Endpoints

### `POST /v1/ir`
### `POST /v2/ir`

Both endpoints accept the same request fields and return an IR JSON file.

- `multipart/form-data` upload: field `inputZip` (zip of a repo)
- or `repoUrl` (clone from git)

Body fields:
- `mode` (or `language`): `react` | `angular` | (anything else → `none`)
- `deps`: truthy to include dependency/call edges (`--deps all`)

Response:
- `application/json` IR model
- Headers:
  - `X-IR-Schema: v2` (IR schema v2 compatible; includes `stereotypeDefinitions` + `stereotypeRefs`)

## Notes

- The service is intentionally a pass-through: it runs the CLI and returns the produced JSON.
- IR schema v2 is a superset of v1; legacy `stereotypes` remain present.
