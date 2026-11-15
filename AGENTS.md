# Repository Guidelines

## Scope
- `xian-playground-web` owns the in-browser contract playground: a static
  Next.js app that runs the contract compiler (`@xian-tech/compiler`) and the
  node VM (`@xian-tech/vm`) as WebAssembly. There is no server component.
- Compiler and VM semantics belong to `../xian-contracting`; this repo only
  adapts them (`src/lib/engine/`). Do not reimplement execution rules here.

## Project Layout
- `src/app/`: Next.js App Router entry; the playground is client-only.
- `src/components/playground/`: panels, forms, header, Monaco setup.
- `src/components/ui/`: shadcn/ui components, owned in the repo (add new ones
  with the shadcn CLI, then adapt).
- `src/lib/`: framework-free logic (values, contract, engine, playground
  controller, workspace). Keep business logic here and unit-tested.
- `tests/unit/` (Vitest, real WASM where possible), `tests/e2e/` (Playwright
  against the static export on the real VM).

## Rules
- Contract values stay exact: wire JSON text in and out of the engine
  (`__fixed__`, `__big_int__`, ...), never JavaScript numbers. Parsing and
  display must not change a value (see `src/lib/values/`).
- Share links and imported files are untrusted: validate with
  `parseWorkspaceDoc` and redeploy contracts from source, never import raw VM
  state or IR from them.
- Browser storage can be missing or blocked; every access stays guarded.
- No public RPC endpoints or public chain IDs in defaults.

## Validation
- `npm run build:wasm` (needs the sibling `xian-contracting` checkout, Rust with
  the wasm32 target and wasm-pack), then `npm ci`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
  `npm run test:e2e` (after `npx playwright install chromium`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared Agent Practices
- Keep changes clean, modular, and professional. Prefer small, cohesive modules, clear naming, explicit boundaries, and tests over quick patches.
- When code behavior, public APIs, user workflows, operator workflows, or configuration semantics change, check whether `../xian-docs-web` needs corresponding documentation updates. If this repo is `xian-docs-web`, update the relevant published docs in place. Write durable user/developer documentation, not a changelog entry.
- Follow `../xian-meta/docs/CODE_GRAPH_WORKFLOW.md` for graph freshness and source verification. Before relying on graph results, run `python3 ../xian-meta/scripts/graphify_workspace.py status --repo xian-playground-web` and refresh that repo if stale.
- For codebase questions, use the local graph first when `graphify-out/graph.json` exists: run `graphify query "<question>"`; use `graphify affected "<symbol>" --depth 1` for direct dependents, larger depths for transitive impact, and `graphify path "<A>" "<B>" --directed` for call paths and `graphify explain "<concept>"` for focused concepts.
- Dirty `graphify-out/` files are expected after hooks or incremental updates and are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- Use `graphify-out/wiki/index.md` for broad navigation when it exists. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- For any non-trivial code change, update the local graph before final verification when `graphify-out/graph.json` exists. Run `python3 ../xian-meta/scripts/graphify_workspace.py refresh --repo xian-playground-web` from the repo root; use `--force` only for inspected, intentional shrinkage.
- After updating the graph, check cross-repo impact before finishing: use `graphify affected`, inspect returned source locations, and search affected sibling repos. A missing edge or truncated result does not prove there are no other consumers.
- If graphify or dependency analysis shows affected sibling repos, update those repos in the same change when the impact is real and the fix is in scope.
- Treat `graphify-out/` as a generated local artifact. Do not commit it.
