# DataFoundry Full Brand Rename Goal

## Goal

Make the repository, product surface, package/workspace names, CLI/TUI surface, code API symbols, tests, and public documentation consistently use `DataFoundry`.

## Success Criteria

1. Public-facing documentation, README files, VitePress config, GitHub links, and GitHub Pages base path use `DataFoundry`.
2. NPM workspace names and internal package imports use the `@datafoundry/*` scope.
3. TUI package, binary, help text, UI banner, logger directory, and tests use `DataFoundry` naming.
4. Runtime code API symbols use `DataFoundry` naming, including agent factory, run context factory, tool registry factory, and AG-UI bridge class.
5. Internal scripts and smoke checks use the new package scope and renamed code symbols.
6. Old README/doc image references remain valid after prior asset cleanup.
7. Validation commands run after implementation:
   - `npm install --package-lock-only`
   - `npm run build`
   - targeted smoke checks covering renamed packages and symbols.
8. The tracked tree has no old brand strings outside this goal document's legacy inventory section and intentionally historical binary/generated assets, if any.

## Explicit Scope

- Root package identity and workspace scripts.
- All `apps/*/package.json` and `packages/*/package.json` package names and dependency references.
- TypeScript imports using the old package scope.
- Public README and Chinese README.
- VitePress docs config, docs landing page, public docs, GitHub Pages path, and GitHub repository links.
- TUI command name, package name, bin name, help text, banners, logger path, and tests.
- Runtime API symbols and tests:
  - `createDataAgent`
  - `createDataAgentRunContext`
  - `createDataAgentToolRegistry`
  - `CreateDataAgentInput`
  - `CreateDataAgentToolRegistryInput`
  - `DataAgentAgUiAgent`
  - AG-UI agent key `dataAgent`
- Internal docs under `.docs-internal/` where they reference the old product name or renamed code symbols.
- Smoke scripts that assert architecture boundaries by symbol name or package scope.

## Out Of Scope

- Editing untracked local drafts and `.DS_Store` files currently present in the working tree.
- Renaming the local checkout directory on disk.
- Renaming the GitHub repository through the remote provider API during this code pass. The codebase will point at the intended `datagallery-lab/DataFoundry` URL, and the remote rename can be performed as a release step.

## Rename Map

| Legacy string | New string | Notes |
| --- | --- | --- |
| `DataAgent` | `DataFoundry` | Product display and PascalCase code symbols. |
| `Open Data Agent` | `DataFoundry` | Public docs and VitePress title. |
| `Data Agent` | `DataFoundry` | Product/runtime display name. |
| `dataagent` | `datafoundry` | Lowercase slug, local directories, DOM event names. |
| `data-agent` | `data-foundry` | Kebab-case agent ids and paths. |
| `open-data-agent` | `datafoundry` or `data-foundry` | Package scope becomes `@datafoundry/*`; non-scope kebab identifiers become `data-foundry-*`. |
| `@open-data-agent/*` | `@datafoundry/*` | NPM workspace scope. |
| `@dataagent/tui` | `@datafoundry/tui` | TUI package. |
| `dataagent-tui` | `datafoundry-tui` | CLI binary. |
| `dataAgent` | `dataFoundry` | Internal AG-UI/Mastra agent key. |
| `datagallery-lab/dataagent` | `datagallery-lab/DataFoundry` | Intended GitHub repository URL. |
| `/dataagent/` | `/DataFoundry/` | Intended GitHub Pages base path after repo rename. |

## Verification Plan

1. Regenerate `package-lock.json` after package scope changes.
2. Run a brand residue check over tracked files.
3. Run `npm run build`.
4. Run focused smoke checks for config API, skills, agent runtime, context architecture, and docs.
5. If `npm run smoke:docs` fails only because of pre-existing untracked local drafts, record that separately and verify tracked docs links directly.
