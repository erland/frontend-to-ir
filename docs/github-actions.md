# GitHub Actions

This repository includes two workflows:

- **CI** (`.github/workflows/ci.yml`): runs `npm ci`, `npm test`, and `npm run build` on Node 20 and 22 for all pushes and pull requests.
- **Package** (`.github/workflows/package.yml`): on `workflow_dispatch` or tags `v*.*.*`, runs tests + build and uploads:
  - `npm pack` tarball (`*.tgz`)
  - a `frontend-to-ir-bundle.zip` containing `dist/`, `docs/`, `README.md`, and package metadata.

## Tagging releases

Creating a tag like `v0.2.0` will trigger the Package workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```
