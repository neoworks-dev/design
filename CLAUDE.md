# penpot-figma-clone

Offline desktop design tool in the spirit of Figma/Penpot: vector canvas, frames, components, auto
layout, prototyping. Two things set it apart: **AI built in** (agents edit the document through the
same API as everything else) and **total plugin extensibility**. Every feature, including the
sidebars, toolbar, canvas tools and property sections, is a plugin on `@neoworks/extension-system`.

No server, no account. Files live on disk.

## Stack

| Piece    | What                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Shell    | Electron 44, frameless window, `app://` protocol serving the SvelteKit build        |
| Renderer | SvelteKit 3 as SPA (`adapter-static`, `ssr = false`), Svelte 5 runes only           |
| Kernel   | `@neoworks/extension-system`: `Context`, `Service`, fibers, revertible effects      |
| UI       | `@neoworks-dev/ui` tokens and components, Tailwind v4, `phosphor-svelte` icons      |
| AI       | `@neoworks/harness` (Claude Code / Codex / pi through one SDK), Electron main only  |
| Lint     | `@neoworks/lint-config`: oxlint (type-aware) for TS, ESLint for `.svelte`, Prettier |

All `@neoworks*` packages are **`bun link`ed** from sibling checkouts (`../extension-system`,
`../combined-agent-harness-adapter`, `../neoworks.dev/packages/ui`, `../lint-config`). Fix bugs
in those packages at the source, not with workarounds here.

SvelteKit 3 has no `svelte.config.js`: kit and svelte options go in `sveltekit({...})` in
`vite.config.ts`. `resolve.dedupe: ['svelte']` is load-bearing — linked packages would otherwise
pull a second svelte runtime.

## Commands

```sh
bun run dev            # vite dev server (renderer only, works in a browser)
bun run electron:dev   # compile electron/, start vite and open electron against it
bun run build          # vite build + electron compile
bun run check          # svelte-check + tsc on electron/
bun run lint           # prettier + oxlint + eslint
bun run qa <command>   # drive an isolated instance over CDP (see design-debug skill)
```

Electron code in `electron/*.ts` is bundled with `bun build` into `electron/dist/`. Dev mode is
selected by `DEV_SERVER_URL`, **not** `NODE_ENV`: bun inlines `process.env.NODE_ENV` at build time.

## Layout

```
electron/            main process: window, app:// protocol, IPC routes, harness, file IO
  bridge.ts          DesktopBridge type: the only API the renderer sees (window.desktop)
src/
  lib/kernel/        root Context, boot, kernel test helpers
  lib/registries/    rune registries (.svelte.ts): regions, commands, keymap, menus, ...
  lib/document/      scene graph types and pure operations (no Svelte, no kernel)
  plugins/<id>/      one directory per built-in plugin: index.ts + its components
  routes/            a single route that renders the root region; nothing feature-specific
docs/research/       Figma/Penpot data model, interactions, plugin API, rendering notes
docs/references/     Mobbin screenshots of Figma (see mobbin/INDEX.md)
```

## Architecture: everything is a plugin

The route renders **one** thing: the `root` region. Which regions exist, how they are arranged and
what fills them is decided by plugins. Removing the layers-panel plugin removes the layers panel;
removing the workbench-layout plugin leaves an empty window. Nothing in `src/routes` may know about
a specific feature.

### Kernels

Two kernels, never sharing a `Context`:

- **Renderer kernel** — owns UI, document, tools, selection, history. Most plugins live here.
- **Main kernel** — owns disk, native dialogs, menus, the AI harness, plugin discovery. IPC
  handlers are registered as effects (`ipcMain.handle` with `removeHandler` as the inverse), one
  plugin per IPC domain.

The preload bridge is typed in `electron/bridge.ts` and shared by both sides.

### Three building blocks

1. **Registry** — a `.svelte.ts` class holding `$state`, with `register(entry) => dispose`.
   Replace-by-id, but **dispose by identity**: a disposer removes only the entry it registered,
   never whatever currently holds that id.
2. **Service** — a `Service` subclass that composes registries into one semantic API (e.g.
   `ctx.panels.register(...)` registers a region entry, a command to toggle it and its shortcut).
   Services declare every dependency in `static inject` and reach other services via `this.ctx`,
   never by importing singletons. **No `$state` fields on `Service` subclasses** — `isolate` and
   `intercept` rebuild services with `Object.create()`, which breaks rune accessors. Keep
   reactive state in the registry the service delegates to.
3. **Plugin** — `{ name, inject, Config?, apply(ctx, config) }` that contributes through
   services, every contribution wrapped in a labelled `ctx.effect(() => register(...), 'label')`.

### Contribution points (renderer)

Each is a service; add new ones the same way rather than special-casing UI.

| Service                                               | Contributes                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `regions`                                             | named slots (`root`, `left`, `right`, `top`, `bottom`, `canvas-overlay`, ...) and the components that fill them |
| `panels`                                              | sidebar tabs and stacked property sections (Design / Prototype / Inspect)                                       |
| `tools`                                               | canvas tools: pointer handlers, cursor, overlay, shortcut, toolbar entry                                        |
| `commands`                                            | `{ id, title, run, when? }`; the palette, menus and keymap reference commands by id                             |
| `keymap`                                              | bindings to command ids, scoped by context (`global`, `canvas`, `text-edit`, ...)                               |
| `menus`                                               | app menu, **context menus** (also a registry, keyed by target kind), toolbar menus                              |
| `inspectors`                                          | property-panel sections per node type / selection shape                                                         |
| `document`                                            | scene graph, `apply(changes)`, `documentchange` events                                                          |
| `history`                                             | undo/redo over change sets                                                                                      |
| `selection`, `viewport`, `renderer`, `snapping`, `ai` | as named                                                                                                        |

### Components and ctx

The host region renders each contribution with its owning plugin's `ctx` passed via
`setContext`, so components call `getKernel()` (wrapper around `getContext`) rather than
importing singletons. Component-level side effects that outlive the component (global listeners,
timers) still go through `ctx.effect`.

### Document model

Plain serialisable data. **Decisions live in `docs/design/data-model.md`** (wins over research).
Background and candidate schema: `docs/research/data-model.md` (`[K]` facts there are unverified).

- **Flat node map** keyed by id; each node stores `parentId` and a fractional-index string for its
  position among siblings. No nested child arrays in storage.
- **Node types are a discriminated union** composed from property mixins (geometry, fills/strokes,
  effects, corners, layout, constraints, ...), not a class hierarchy.
- **Derived data is cache, not state**: absolute transforms/bounds, auto-layout results and text
  layout are recomputed, never saved.
- **Vector networks** are the canonical vector format; SVG paths are import/export.
- **Instances are materialized copies**: real nodes linked to main-component counterparts via
  `componentRef`, overrides tracked as `touched` property groups, kept in sync by a sync engine.
- **Text** is paragraphs of styled runs (deltas over a default style), mirroring Skia's Paragraph.
- **Variables are first-class from day one**: every consumer reads resolved values.
- **Files are SQLite** (`node:sqlite` in main): node rows, asset blobs, change log; incremental
  autosave per transaction.

Every mutation is a change set `{ ops, inverse }` applied through `ctx.document.apply()` — UI,
tools, plugins and AI all use this one path. That gives undo/redo, `documentchange` events and an
audit trail for AI edits for free. A whole plugin or AI run is one undo step. `src/lib/document/`
stays pure (no kernel, no Svelte) so it can be unit-tested and run in a worker.

### Rendering

CanvasKit (Skia wasm) behind a `renderer` service interface, so Canvas2D or headless export
backends can be swapped in. Selection handles, guides and tool feedback draw on a separate overlay
layer contributed by plugins. Hit testing uses a spatial index over cached absolute bounds. See
`docs/research/rendering.md`.

### AI

The harness runs in main. The renderer exposes the document as MCP-style tools (read tree, query
selection, apply changes, run command) that the agent calls over IPC. AI edits are ordinary change
sets: undoable, attributable, visible in history. AI features (chat panel, generate, rename
layers, ...) are plugins like everything else.

### Third-party plugins

Discovered from disk by the main kernel (built-in, user data dir, per-project). Each runs in its
own Web Worker behind one fiber. Manifest `contributes` entries become lazy stubs that activate the
worker on first use. Worker UI is declarative (JSON surface tree rendered by the host). Built-in
plugins use exactly the same services, so the public API is never second-class.

### Rules

- **Every side effect has an inverse.** Mount → unmount must leave observable state identical.
  Raw DOM listeners, timers, observers, IPC handlers go in `ctx.effect`.
- **Never use an outer `ctx`** inside a plugin; effects attach to the wrong fiber and leak.
- **Inject what you use.** Hidden dependencies via imports defeat reactive loading.
- **Boot with `Promise.allSettled`** and surface per-plugin failures; one broken plugin must not
  blank the app.
- **Per-plugin settings use the plugin's `Config` schema + `fiber.update`**, not a parallel
  settings system. Keys of plugin-provided services and settings are prefixed with the plugin id;
  bare names belong to core.
- **Use kernel events** (`ctx.on` / `ctx.emit` / `waterfall`) for cross-plugin notification and
  middleware; pick the dispatch mode deliberately.
- Load the `extension-system` skill before writing kernel code and `ui-components` before writing
  UI. Reuse `@neoworks-dev/ui` components and semantic token classes; add missing generic
  components to the UI package (with a story) instead of hand-rolling them here.

## Tests

`bun run test` (vitest; compiles `.svelte.ts` runes). Every plugin gets the standard kernel test: mount, assert contribution present,
dispose, assert state identical to before. Architecture rules (feature code outside
`src/routes`, plugins declare `inject`) are enforced by source-level tests.

## Debugging the running app

Use the `design-debug` skill: `bun run qa start|probe|click|screenshot|eval|logs|stop` runs an
isolated instance on a virtual Xvnc display (watchable via `vncviewer`), driven over CDP. Never
launch the app on the user's desktop to check something. QA renders WebGL with SwiftShader:
correct pixels, unrepresentative performance. The renderer sets `<html data-ready="true">` after
boot and exposes `window.__design_debug` (debug plugin) for canvas state that isn't in the DOM.

## Code style

Readability over cleverness. Descriptive names, no abbreviations. Guard clauses instead of
nesting (max two levels). Short single-purpose functions. Avoid `??`, ternaries and chained
nullish fallbacks where explicit control flow reads better; lint-config enforces explicit return
types, no `any`, no non-null assertions, no floating promises. Comments only for non-obvious
technical reasons. Tabs, single quotes, 100 columns (Prettier).

## Reference material

- `docs/research/` — data model, interaction catalogue, plugin APIs, rendering options.
- `docs/references/mobbin/` — Figma UI screenshots, indexed in `INDEX.md`.
- `/home/moritz/Documents/git-worktree-editor` — Grove, the previous app built on this kernel.
  Copy its registry/service/plugin split; avoid its known flaws (services importing singletons
  without `inject`, dispose-by-id, context menus outside the registry system, all-or-nothing boot).
