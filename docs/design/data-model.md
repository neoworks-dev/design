# Document data model — decisions

Status: decided 2026-10-04. Background and the full candidate schema: `docs/research/data-model.md`
(§12). This file records what we chose and why; where it disagrees with the research sketch, this
file wins.

## 1. Storage shape

- **Flat node map** `Record<NodeId, Node>`. Each node stores `parentId` and `index` (fractional
  index string, sorted lexicographically among siblings). Children are derived, never stored.
- **No DOCUMENT node.** Pages are nodes with `parentId: null`, ordered by `index`.
- **IDs** are random strings (nanoid). Multiplayer-style `client:counter` ids are not needed offline.
- **Figma type names** (`FRAME`, `RECTANGLE`, `INSTANCE`, ...) and property names wherever
  practical, so the Figma-compatible plugin API and AI prompts map with little translation.
- Node types are a **discriminated union composed from property mixins** (Base, Layout, Blend,
  Geometry, Corner, Constraint, AutoLayout), not classes.
- Geometry: `transform` (2×3, relative to parent) + `width`/`height`. Colors are RGB(A) floats 0..1.
- **Derived data is cache**: absolute transforms/bounds, auto-layout results, text layout, vector
  geometry, resolved variable values. Recomputed, never persisted.
- `pluginData` on every node, namespaced by plugin id.

## 2. Components and instances — materialized copies

Instance subtrees are **real nodes** in the map (Penpot model; Figma also exposes instance children
as nodes). Renderer, hit testing, layers panel, plugins and AI handle them like any other node.

- An instance root stores `mainComponentId` and `componentProperties`.
- Every node inside an instance stores `componentRef`: the id of its counterpart in the main
  component (for nested instances, the counterpart in the nearest main).
- Every such node stores `touched`: the set of **property groups** the user overrode (e.g.
  `fills`, `strokes`, `effects`, `text-content`, `text-style`, `geometry`, `visibility`, `layout`,
  `name`). Granularity is the group, not the single property.
- **Sync engine**: a change to a main component node is propagated to every counterpart, skipping
  groups listed in that counterpart's `touched`. Propagation emits ordinary changes inside the same
  transaction, so undo covers it.
- Reset overrides = clear `touched` groups and re-sync. Detach = drop `mainComponentId`,
  `componentRef` and `touched` from the subtree.
- Instance swap / variant switch = replace the subtree, carrying over touched groups whose
  counterparts match by name path (Figma behaviour).

Open: exact list of property groups; cycle prevention (component containing its own instance).

Implementation notes (`src/lib/document/components*.ts`, plugin `component-sync`):

- A node's counterpart is its `componentRef`, or `mainComponentId` for an instance root. A nested
  instance's nodes point at the node they were copied from, so counterparts chain (instance ->
  outer main -> inner main) and a change propagates one level per `document/append` round.
- The edits an instance root owns itself (`transform`, `visible`, `locked`, `layoutPositioning`,
  `layoutSizing*`, `constraints`, `componentProperties`) are neither synced from the main nor
  recorded as overrides.
- `touched` is added to the user's own `set` in `document/before-apply`; sync, undo and redo never
  mark anything. Run text is one property (`paragraphs`): an edit that changes the text marks
  `text-content`, one that only changes styles marks `text-style`, and either blocks syncing it.
- Deleting a main component leaves its instances; they keep `mainComponentId` and can restore the
  main (`planRestoreMain`, new component with the old ids). Validation skips a missing main.
- `componentPropertyReferences` on a main's layer says which component property drives its
  `visible`, `characters` (text) or `mainComponent` (nested instance). Instances do not copy it.
- Performance budget: a main edit with 500 instances propagates in one transaction in under
  250 ms (test `propagates a main edit to 500 instances within the budget`).

## 3. Text — paragraphs of runs

```ts
interface TextNode { paragraphs: Paragraph[]; defaultStyle: TextStyle; /* + resize, align, ... */ }
interface Paragraph { runs: TextRun[]; align; indent; spacingAfter; list; listLevel }
interface TextRun { text: string; style: Partial<TextStyle> }   // delta over defaultStyle
```

Maps directly onto Skia's `ParagraphBuilder` (`pushStyle`/`addText`/`pop`). Editing ops must
**normalize**: merge adjacent runs with equal styles, drop empty runs, keep at least one paragraph.
Text style ids and variable bindings live on the run style.

## 4. Variables — full support from the start

- File holds `variableCollections` (modes, default mode) and `variables` (`valuesByMode`, alias
  values allowed, scopes, codeSyntax).
- Any bindable property records its binding in `boundVariables` on the node / paint / effect /
  text run style. The raw property value stays as the last resolved fallback.
- Frames, sections and pages may set `explicitVariableModes` per collection; mode is inherited
  down the tree.
- **Every consumer reads resolved values** through a `resolve` step in the derived layer (renderer,
  layout, inspector, export, plugins, AI). Resolution is cached per node and invalidated by
  changes to the node, its ancestors' modes, or the variables it references (alias chains
  included).
- Alias cycles are rejected at write time.

## 5. Changes and transactions

```ts
type Change =
  | { t: 'add'; node: Node }
  | { t: 'del'; node: Node }                        // carries snapshot so it inverts to add
  | { t: 'set'; id: NodeId; set: Record<string, unknown>; prev: Record<string, unknown> }
  | { t: 'move'; id: NodeId; parent: NodeId | null; index: string; prevParent: NodeId | null; prevIndex: string }
  | /* same shapes for styles, variables, collections, assets */
interface Transaction { id; origin: 'user' | 'plugin' | 'ai' | 'sync'; label; changes; undo; mergeKey? }
```

- `set` is **property-level, top-level keys only**: setting `fills` replaces the array.
- One gesture / one plugin run / one AI run = one transaction = one undo step. `mergeKey`
  coalesces nudges and typing.
- Component sync and auto-layout reflow append their changes to the triggering transaction.

## 6. File format — SQLite via `node:sqlite`

Single-file document (`.design`, final extension TBD), opened in the **main** process with Node's
built-in `node:sqlite` (verified in Electron 44 / Node 24.21, no native rebuild).

Tables (sketch):

| Table | Content |
| --- | --- |
| `meta` | schema version, file id, name, created/modified |
| `nodes` | `id`, `parent_id`, `idx`, `type`, `data` (JSON of the rest) |
| `styles`, `variables`, `variable_collections` | id + JSON |
| `assets` | `hash` (sha-256), `mime`, `width`, `height`, `bytes` (BLOB) |
| `fonts` | referenced fonts, embedded font blobs |
| `transactions` | append-only change log for version history / crash recovery (prunable) |
| `thumbnails` | file + page previews for the file browser |

- The renderer kernel holds the live document. Each committed transaction is sent to main over
  IPC (debounced) and written as one SQLite transaction touching only affected rows — incremental,
  crash-safe autosave.
- WAL mode. Schema migrations keyed by `meta.schema_version`.
- Export/import as zip-of-JSON can be added as a separate plugin for diffing and sharing.

## 7. Provisional answers to the open questions (#2)

Status: **provisional** — chosen to unblock implementation, awaiting maintainer sign-off on #2.
Anything here may change; code should keep these choices localized.

**Touched groups.** One group per inspector section, so "reset" in a section maps to one group:
`name`, `visibility` (visible, locked), `geometry` (width, height, transform, constraints,
min/max, layoutSizing*, layoutPositioning), `corners`, `fills`, `strokes`, `effects`,
`blend` (opacity, blendMode, isMask, maskType), `auto-layout` (all AutoLayoutProps + layoutGrids),
`text-content` (paragraph text), `text-style` (run styles, defaultStyle, paragraph props, text
resize/align), `vector` (network), `prototype` (reactions), `component-properties`
(componentProperties on nested instances), `plugin-data`. A variable binding belongs to the group
of the property it binds.

**Cycle prevention.** Rejected at write time in `document.apply`: inserting an instance of main
component M anywhere inside M (directly or via nested instances' mains) throws, so UI, plugins
and AI all get it. UI additionally greys out the offending components in the assets panel.

**Nested instance sync.** Counterparts are resolved by `componentRef` chains, innermost main
first; the outer main's change propagates only where the inner instance hasn't touched the group.
On swap, touched groups carry over to nodes matching by name path; unmatched overrides are
dropped (Figma behaviour).

**File.** Extension `.ndesign`, MIME `application/vnd.neoworks.draftboard+sqlite`, macOS UTI
`dev.neoworks.draftboard`. SQLite `application_id` pragma = `0x4E574453` ("NWDS") as the magic
marker; `user_version` = schema version.

**SQLite.** One row per node; `data` holds the node JSON minus columns (`id`, `parent_id`, `idx`,
`type`). Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`. Transaction log
pruned to the last 1000 transactions or 30 days. Every transaction is persisted (the renderer
commits each one, debounced), so there is no unsaved in-memory state, no Save command and no
Save/Don't Save prompt: closing a window or quitting only flushes the renderer's queue. A
checkpoint (WAL fold plus a "Saved" history mark) remains for version history.

**Library.** Files live in the library root: `$XDG_DATA_HOME/draftboard` (default
`~/.local/share/draftboard`) on Linux, `Documents/Draftboard` elsewhere; `DRAFTBOARD_LIBRARY_DIR`
overrides it (QA, tests). "New" creates `Untitled.ndesign` there straight away (`Untitled 2`, ...),
so there are no untitled temp files. Folders are real directories, one level under the root; a
file's name on disk is its document name. Directories elsewhere (a shared repository) can be
added as **linked folders** (id, name, path in `<userData>/linked-folders.json`) and are listed
like library folders, including their direct subdirectories. A single file opened from elsewhere
is only known through the recent list (`<userData>/recent-files.json`). Main accepts a directory
argument only when its real path is the root, a library folder, a linked folder or a direct
subdirectory of a linked one (symlinks cannot lead out). Renaming, moving or trashing a file that
a window has open flushes it, reopens it at the new path and pushes `files:moved`. Older
versions kept untitled documents in `<userData>/untitled/`; at startup the ones with edits move
into the library root and empty ones are deleted.

**Text.** Lists are paragraph properties (`list`, `listLevel`); links are a `hyperlink` on the
run style; fonts are referenced by `{ family, style }` on the run style. A missing font keeps its
reference in the document; the renderer substitutes at draw time and the UI flags it — the
substitution is never persisted. Normalization merges adjacent runs whose styles, `textStyleId`
and `boundVariables` are all deep-equal.

**Vectors.** Vector network is canonical, stored as JSON (`vertices`, `segments`, `regions`).
Flatten and boolean results are VECTOR nodes with a network (booleans stay live
BOOLEAN_OPERATION nodes until flattened).

**Prototyping.** Reactions are node properties (`reactions`); flow starting points live on the
page node. No separate table.

**Libraries.** v1 is single-file: components, styles and variables come from the open file only.
Cross-file libraries are deferred; the assets panel does not design for team libraries.

**Variables.** Scopes are enforced in the UI picker only (binding a mismatched scope via API is
allowed). `codeSyntax` is stored and shown in inspect, no other behaviour. A binding whose
variable no longer matches the property type resolves to the raw property value and is flagged
in the inspector. Instances inherit modes like any subtree; `explicitVariableModes` on an
instance overrides its main's.
