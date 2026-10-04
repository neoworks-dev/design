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
