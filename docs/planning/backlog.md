# Implementation backlog

Generated plan for the offline design tool. Source of truth for issue text is GitHub (`neoworks-dev/design`); this file is the reviewable index. Data model decisions: `docs/design/data-model.md`. Interaction detail: `docs/research/interactions.md` (facts tagged `[K]` are unverified).

Conventions: every issue names its owning plugin id and the services it injects/provides; every plugin issue includes the standard mount/unmount kernel test; issues touching node data depend on the data-model implementation issue (`DM`).

## Epics

- #163 Epic: Foundation (kernel, registries, IPC) (area:kernel, M0 Foundation)
- #164 Epic: Document core (model, changes, history, selection, SQLite file) (area:document, M1 Canvas & core editing)
- #165 Epic: Rendering (CanvasKit, viewport, hit testing, text) (area:rendering, M1 Canvas & core editing)
- #166 Epic: Canvas tools (select, transform, shapes, vector, text) (area:canvas-tools, M1 Canvas & core editing)
- #167 Epic: Snapping and guides (area:canvas-tools, M1 Canvas & core editing)
- #168 Epic: Editing operations (area:editing, M1 Canvas & core editing)
- #169 Epic: Panels as plugins (layers, pages, assets, design panel, pickers, inspect) (area:panels, M2 Panels & properties)
- #170 Epic: Command palette, shortcuts, menus and settings (area:app, M2 Panels & properties)
- #171 Epic: Components, variants, styles and variables (area:components, M3 Components, styles & layout)
- #172 Epic: Auto layout and constraints (area:layout, M3 Components, styles & layout)
- #173 Epic: AI (harness, tools bridge, chat, features) (area:ai, M4 AI)
- #174 Epic: Third-party plugins (area:plugins, M5 Plugins & ecosystem)
- #175 Epic: Prototyping and presentation (area:prototype, M6 Prototyping, export & polish)
- #176 Epic: Export (PNG, JPG, SVG, PDF) (area:export, M6 Prototyping, export & polish)
- #177 Epic: App shell and distribution (area:app, M2 Panels & properties)

## Milestones

### M0 Foundation (19 issues)

- #1 `DM` Document model types and schema (implements docs/design/data-model.md)
- #2 `DMO` Resolve open data-model questions
- #3 `K1` Kernel boot with allSettled and per-plugin failure report
- #4 `K2` Rune registry base class (replace by id, dispose by identity)
- #5 `K3` Regions registry, getKernel/setContext bridge and root region rendering
- #6 `K4` Commands registry and service
- #7 `K5` Keymap registry and service (scopes, Mod, text-edit gating)
- #8 `K6` Menus registry and service (app menu, context menus keyed by target kind)
- #9 `K7` Panels service (sidebar tabs and stacked property sections)
- #10 `K8` Inspectors registry (property sections per node type and selection shape)
- #11 `K9` Tools registry and service (pointer protocol, cursor, overlay, toolbar entry)
- #12 `K10` Kernel test helper (mount, unmount, state-identical)
- #13 `K11` Architecture source tests
- #14 `K12` Main kernel (Electron main process)
- #15 `K13` IPC route() helper in main
- #16 `K14` Preload bridge growth and renderer `desktop` service
- #17 `K15` workbench-layout plugin: arrangement of regions and resizable sidebars
- #134 `K16` Debug plugin: window.__design_debug
- #137 `AP1` Window shell: frameless window, controls, window state

### M1 Canvas & core editing (64 issues)

- #18 `D1` Pure document library: ids, tree queries, fractional index, derived-data caches
- #19 `D2` Change pipeline: document.apply(transaction)
- #21 `D3` History service: undo/redo and grouping
- #20 `D4` Selection service
- #22 `D5` Pages in the document service
- #23 `D6` Variable resolver in the derived layer
- #24 `D7` Text run operations and normalization (pure)
- #25 `D8` SQLite document store in main (node:sqlite): schema, migrations, load
- #26 `D9` Incremental persistence per transaction, autosave and crash recovery
- #27 `D10` File session: new, open, save, save as, dirty state over IPC
- #28 `D11` Recent files
- #29 `D12` Asset store: images and fonts in the assets and fonts tables
- #32 `R1` CanvasKit bootstrap: wasm loading over app://
- #33 `R2` Renderer service interface, canvas region and render loop
- #34 `R3` Scene drawing: shapes, paints and strokes
- #36 `R4` Gradient and image paints
- #37 `R5` Effects and compositing: opacity, blend, shadows, blurs, masks, clip
- #38 `R6` Overlay layer: screen-space drawing contributed by plugins
- #39 `R7` Viewport service: pan, zoom, zoom to fit/selection
- #40 `R8` Spatial index and absolute bounds cache
- #41 `R9` Hit testing: exact geometry, scope rules, clip and masks
- #35 `R10` Image cache
- #42 `R11` Fonts service: enumeration, loading, missing-font fallback
- #43 `R12` Text layout via the Paragraph API
- #44 `R13` Headless export renderer
- #45 `R14` Render performance: culling, picture caching, perf budget
- #46 `R15` Pixel grid and pixel preview rendering
- #47 `T1` Canvas input router: pointer, keyboard, cursor and modifiers
- #48 `T2` Move/select tool: click, shift, double-click, deep select, hover
- #49 `T3` Marquee selection (incl. deep marquee and frame rules)
- #50 `T4` Keyboard selection navigation
- #51 `T5` Move gesture: drag, axis lock, reparenting, space to pin parent
- #52 `T6` Transform handles: resize with modifiers
- #53 `T7` Rotation zones and rotate gesture
- #54 `T8` On-canvas shape handles: corner radius, ellipse arcs, polygon and star
- #55 `T9` Scale tool (K)
- #56 `T10` Frame tool with presets, and nesting rules
- #57 `T11` Section and slice tools
- #58 `T12` Shape tools: rectangle, ellipse, line, arrow, polygon, star
- #59 `T13` Image placement: tool, paste, drop, crop mode
- #60 `T14` Pen tool: create vector networks
- #61 `T15` Vector edit mode: select, move, delete, join
- #62 `T16` Vector edit: bend tool, handle mirroring, point radius, paint bucket
- #63 `T17` Pencil tool: freehand with curve fitting
- #64 `T18` Text tool: creation and text box sizing
- #65 `T19` Text editing engine: caret, selection, IME, clipboard
- #66 `T20` Rich text formatting commands, lists and links
- #67 `T21` Hand and zoom tools
- #69 `S1` Snapping service and object snapping
- #70 `S2` Equal-spacing guides and distance measurement
- #71 `S3` Pixel grid snapping
- #72 `S4` Rulers and guides
- #96 `E1` Clipboard core: copy, cut, paste, paste here, in place, over selection, replace
- #97 `E2` Copy as SVG/PNG/CSS and copy/paste properties
- #98 `E3` Duplicate and repeat offset
- #99 `E4` Nudge with arrow keys
- #82 `E5` Align, distribute and tidy up
- #100 `E6` Z-order commands
- #101 `E7` Group, ungroup and frame selection
- #102 `E8` Boolean operations (PathOps)
- #103 `E9` Flatten and outline stroke
- #104 `E10` Mask
- #105 `E11` Quick node commands: flip, visibility, lock, opacity, swap fill/stroke, find
- #106 `E12` SVG import: paste and drop to vector layers

### M2 Panels & properties (30 issues)

- #68 `T22` Comment tool and comments panel (local notes)
- #73 `S5` Layout grids (columns, rows, grid)
- #74 `P1` Toolbar plugin: floating tool bar with grouped dropdowns
- #75 `P2` Layers panel: tree, selection sync, expand/collapse, icons
- #76 `P3` Layers panel: drag reorder and nesting
- #77 `P4` Layers panel: visibility, lock, rename, search/filter
- #78 `P5` Pages panel
- #80 `P7` Design panel shell: tabs, stacked sections, selection-aware rendering
- #81 `P8` Shared inspector inputs: numeric scrub field, color swatch, dropdowns
- #83 `P9` Design section: position, alignment, rotation, flip
- #84 `P10` Design section: dimensions and resizing (fixed/hug/fill, min/max, clip)
- #85 `P11` Design section: appearance (opacity, blend, corner radius, visibility, mask)
- #87 `P12` Design section: fill (paint list)
- #88 `P13` Design section: stroke
- #89 `P14` Design section: effects
- #90 `P15` Design section: typography
- #91 `P16` Design section: selection colors (find and replace)
- #92 `P17` Page properties section (background, variables, styles, export rows)
- #86 `P18` Color picker popover
- #93 `P19` Gradient editor
- #94 `P20` Zoom menu in the top bar
- #95 `P21` Inspect panel: code, measurements and ready-for-dev
- #130 `CP1` Command palette plugin
- #132 `CP2` Keyboard shortcut system: presets, rebinding, conflict detection
- #133 `CP3` Shortcut panel and editor (Ctrl+Shift+?)
- #135 `CP4` App menu: in-window menu bar and native Electron menu mirror
- #136 `CP5` Context menus: canvas, layers, empty canvas contents
- #131 `CP6` Settings: preferences store and generated settings UI
- #138 `AP2` Window and file tabs: multiple documents
- #139 `AP3` Home screen and file browser

### M3 Components, styles & layout (15 issues)

- #79 `P6` Assets panel: local library of components and styles
- #107 `C1` Component sync engine (materialized instances, touched groups)
- #108 `C2` Create component, create instance, detach (UI and commands)
- #109 `C3` Instance overrides: reset, push to main, go to main, restore main
- #110 `C4` Component sets and variants
- #111 `C5` Component properties: boolean, text, instance swap, variant
- #112 `C6` Swap instance and assets quick insert
- #113 `C7` Styles: paint, text, effect and grid styles
- #114 `C8` Variables: collections, modes and the variables modal
- #115 `L1` Auto layout engine core: stacks, gap, padding, alignment, hug/fill/fixed
- #116 `L2` Auto layout: wrap, space-between, min/max, absolute positioning, strokes included
- #117 `L3` Auto layout section in the design panel
- #118 `L4` Add/remove auto layout with inference
- #119 `L5` Auto layout canvas handles and drop indicator
- #120 `L6` Constraints engine and widget

### M4 AI (11 issues)

- #142 `A1` AI harness service in Electron main
- #143 `A2` Renderer `ai` service and IPC event stream
- #144 `A3` Document tools bridge: read tree, selection, apply changes, run command
- #145 `A4` AI edits as undoable, attributed change sets
- #146 `A5` AI chat panel plugin
- #147 `A6` Selection-scoped context and screenshot attachment
- #148 `A7` Generate designs from a prompt
- #149 `A8` Rename layers with AI
- #150 `A9` AI search across layers and assets
- #151 `A10` AI change review: preview, accept, reject
- #152 `A11` Natural-language command palette mode and batch operations

### M5 Plugins & ecosystem (10 issues)

- #153 `PL1` Plugin discovery in main: built-in, user and project (with trust)
- #154 `PL2` Manifest schema and `contributes` lazy stubs
- #155 `PL3` Worker host: one Web Worker per plugin behind one fiber
- #156 `PL4` Plugin API v1 (native): document, selection, events, commands over RPC
- #157 `PL5` Declarative UI surface: JSON tree rendered by the host
- #158 `PL6` Plugin permissions and network allowlist
- #159 `PL7` Figma-compatible `figma` API subset in the worker
- #160 `PL8` Plugin storage: pluginData, sharedPluginData, clientStorage
- #161 `PL9` Plugin manager UI and Resources search for plugins
- #162 `PL10` Plugin development: hot reload, console, templates, typings

### M6 Prototyping, export & polish (13 issues)

- #30 `D13` Version history from the transactions log
- #31 `D14` Zip-of-JSON export/import plugin (diffing and sharing)
- #121 `PR1` Prototype panel: flows and interactions list
- #122 `PR2` Prototype connection handles on canvas
- #123 `PR3` Prototype runtime: navigation, overlays, scrolling, animations
- #124 `PR4` Presentation view: present, preview, device frame
- #125 `X1` Export service and export settings model on nodes
- #126 `X2` PNG, JPG and WEBP export
- #127 `X3` SVG export
- #128 `X4` PDF export (custom CanvasKit build)
- #129 `X5` Export section and export dialog
- #140 `AP4` Packaging with electron-builder
- #141 `AP5` Crash and error isolation UI

## Areas and issues

### Epic: Foundation (kernel, registries, IPC)

Everything is a plugin: kernel boot, registries, services, main kernel, IPC and the workbench layout. Nothing else can start before this lands.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #3 | `K1` | Kernel boot with allSettled and per-plugin failure report | area:kernel | M0 | - |
| #4 | `K2` | Rune registry base class (replace by id, dispose by identity) | area:kernel | M0 | #3 |
| #5 | `K3` | Regions registry, getKernel/setContext bridge and root region rendering | area:kernel | M0 | #3, #4 |
| #6 | `K4` | Commands registry and service | area:kernel | M0 | #4, #5 |
| #7 | `K5` | Keymap registry and service (scopes, Mod, text-edit gating) | area:kernel | M0 | #4, #6 |
| #8 | `K6` | Menus registry and service (app menu, context menus keyed by target kind) | area:kernel | M0 | #4, #5, #6, #7 |
| #9 | `K7` | Panels service (sidebar tabs and stacked property sections) | area:kernel | M0 | #5, #6, #7 |
| #10 | `K8` | Inspectors registry (property sections per node type and selection shape) | area:kernel | M0 | #1, #9 |
| #11 | `K9` | Tools registry and service (pointer protocol, cursor, overlay, toolbar entry) | area:kernel | M0 | #5, #6, #7 |
| #12 | `K10` | Kernel test helper (mount, unmount, state-identical) | area:kernel | M0 | #3, #4 |
| #13 | `K11` | Architecture source tests | area:kernel | M0 | #3 |
| #14 | `K12` | Main kernel (Electron main process) | area:kernel | M0 | #3, #12 |
| #15 | `K13` | IPC route() helper in main | area:kernel | M0 | #14 |
| #16 | `K14` | Preload bridge growth and renderer `desktop` service | area:kernel | M0 | #14, #15 |
| #17 | `K15` | workbench-layout plugin: arrangement of regions and resizable sidebars | area:kernel | M0 | #5, #9 |
| #134 | `K16` | Debug plugin: window.__design_debug | area:kernel | M0 | #3 |

### Epic: Document core (model, changes, history, selection, SQLite file)

Data model types, the single `document.apply` mutation path, history, selection, variable resolution, text run operations and the SQLite file format with incremental persistence. Model decisions: `docs/design/data-model.md`.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #1 | `DM` | Document model types and schema (implements docs/design/data-model.md) | area:document | M0 | - |
| #2 | `DMO` | Resolve open data-model questions | area:document | M0 | - |
| #18 | `D1` | Pure document library: ids, tree queries, fractional index, derived-data caches | area:document | M1 | #1, #13 |
| #19 | `D2` | Change pipeline: document.apply(transaction) | area:document | M1 | #1, #18, #3, #12 |
| #21 | `D3` | History service: undo/redo and grouping | area:document | M1 | #1, #19, #20, #6, #7 |
| #20 | `D4` | Selection service | area:document | M1 | #1, #19, #6 |
| #22 | `D5` | Pages in the document service | area:document | M1 | #1, #19, #20 |
| #23 | `D6` | Variable resolver in the derived layer | area:document | M1 | #1, #19, #18 |
| #24 | `D7` | Text run operations and normalization (pure) | area:document | M1 | #1, #18 |
| #25 | `D8` | SQLite document store in main (node:sqlite): schema, migrations, load | area:document | M1 | #1, #15, #14 |
| #26 | `D9` | Incremental persistence per transaction, autosave and crash recovery | area:document | M1 | #1, #25, #19 |
| #27 | `D10` | File session: new, open, save, save as, dirty state over IPC | area:document | M1 | #1, #25, #26, #16, #19 |
| #28 | `D11` | Recent files | area:document | M1 | #27, #8 |
| #29 | `D12` | Asset store: images and fonts in the assets and fonts tables | area:document | M1 | #1, #25, #16 |
| #30 | `D13` | Version history from the transactions log | area:document | M6 | #1, #26, #21 |
| #31 | `D14` | Zip-of-JSON export/import plugin (diffing and sharing) | area:document | M6 | #25, #1 |

### Epic: Rendering (CanvasKit, viewport, hit testing, text)

CanvasKit renderer behind the `renderer` interface, overlay layer, viewport, spatial index, hit testing, text via Paragraph API, fonts, headless export.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #32 | `R1` | CanvasKit bootstrap: wasm loading over app:// | area:rendering | M1 | #14, #16 |
| #33 | `R2` | Renderer service interface, canvas region and render loop | area:rendering | M1 | #1, #32, #19, #5 |
| #34 | `R3` | Scene drawing: shapes, paints and strokes | area:rendering | M1 | #1, #33, #18, #23 |
| #36 | `R4` | Gradient and image paints | area:rendering | M1 | #1, #34, #35 |
| #37 | `R5` | Effects and compositing: opacity, blend, shadows, blurs, masks, clip | area:rendering | M1 | #1, #34 |
| #38 | `R6` | Overlay layer: screen-space drawing contributed by plugins | area:rendering | M1 | #33, #5 |
| #39 | `R7` | Viewport service: pan, zoom, zoom to fit/selection | area:rendering | M1 | #20, #22, #6, #7 |
| #40 | `R8` | Spatial index and absolute bounds cache | area:rendering | M1 | #1, #18, #19 |
| #41 | `R9` | Hit testing: exact geometry, scope rules, clip and masks | area:rendering | M1 | #1, #40, #34, #20 |
| #35 | `R10` | Image cache | area:rendering | M1 | #32, #29 |
| #42 | `R11` | Fonts service: enumeration, loading, missing-font fallback | area:rendering | M1 | #32, #15, #16 |
| #43 | `R12` | Text layout via the Paragraph API | area:rendering | M1 | #1, #33, #42, #24, #23 |
| #44 | `R13` | Headless export renderer | area:rendering | M1 | #1, #34, #37, #43 |
| #45 | `R14` | Render performance: culling, picture caching, perf budget | area:rendering | M1 | #34, #37, #40 |
| #46 | `R15` | Pixel grid and pixel preview rendering | area:rendering | M1 | #38, #39, #7 |

### Epic: Canvas tools (select, transform, shapes, vector, text)

Canvas input router and every tool as a plugin on the `tools` service.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #47 | `T1` | Canvas input router: pointer, keyboard, cursor and modifiers | area:canvas-tools | M1 | #11, #39, #41, #20 |
| #48 | `T2` | Move/select tool: click, shift, double-click, deep select, hover | area:canvas-tools | M1 | #1, #47, #38 |
| #49 | `T3` | Marquee selection (incl. deep marquee and frame rules) | area:canvas-tools | M1 | #48, #40 |
| #50 | `T4` | Keyboard selection navigation | area:canvas-tools | M1 | #1, #20, #7 |
| #51 | `T5` | Move gesture: drag, axis lock, reparenting, space to pin parent | area:canvas-tools | M1 | #1, #48, #21 |
| #52 | `T6` | Transform handles: resize with modifiers | area:canvas-tools | M1 | #1, #48, #38, #21 |
| #53 | `T7` | Rotation zones and rotate gesture | area:canvas-tools | M1 | #1, #52 |
| #54 | `T8` | On-canvas shape handles: corner radius, ellipse arcs, polygon and star | area:canvas-tools | M1 | #1, #52 |
| #55 | `T9` | Scale tool (K) | area:canvas-tools | M1 | #1, #52 |
| #56 | `T10` | Frame tool with presets, and nesting rules | area:canvas-tools | M1 | #1, #11, #21, #38 |
| #57 | `T11` | Section and slice tools | area:canvas-tools | M1 | #1, #56 |
| #58 | `T12` | Shape tools: rectangle, ellipse, line, arrow, polygon, star | area:canvas-tools | M1 | #1, #11, #21, #38 |
| #59 | `T13` | Image placement: tool, paste, drop, crop mode | area:canvas-tools | M1 | #1, #11, #29, #21, #36 |
| #60 | `T14` | Pen tool: create vector networks | area:canvas-tools | M1 | #1, #11, #21, #38 |
| #61 | `T15` | Vector edit mode: select, move, delete, join | area:canvas-tools | M1 | #1, #60 |
| #62 | `T16` | Vector edit: bend tool, handle mirroring, point radius, paint bucket | area:canvas-tools | M1 | #1, #61 |
| #63 | `T17` | Pencil tool: freehand with curve fitting | area:canvas-tools | M1 | #1, #11, #21, #38 |
| #64 | `T18` | Text tool: creation and text box sizing | area:canvas-tools | M1 | #1, #11, #43, #24, #21 |
| #65 | `T19` | Text editing engine: caret, selection, IME, clipboard | area:canvas-tools | M1 | #1, #64, #38, #21, #7 |
| #66 | `T20` | Rich text formatting commands, lists and links | area:canvas-tools | M1 | #1, #65, #24 |
| #67 | `T21` | Hand and zoom tools | area:canvas-tools | M1 | #11, #39, #47 |
| #68 | `T22` | Comment tool and comments panel (local notes) | area:canvas-tools | M2 | #1, #11, #9, #38 |

### Epic: Snapping and guides

Object snapping, spacing guides and measurement, pixel grid, rulers and guides, layout grids.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #69 | `S1` | Snapping service and object snapping | area:canvas-tools | M1 | #1, #40, #38, #39 |
| #70 | `S2` | Equal-spacing guides and distance measurement | area:canvas-tools | M1 | #69 |
| #71 | `S3` | Pixel grid snapping | area:canvas-tools | M1 | #69, #46 |
| #72 | `S4` | Rulers and guides | area:canvas-tools | M1 | #1, #69, #38 |
| #73 | `S5` | Layout grids (columns, rows, grid) | area:canvas-tools | M2 | #1, #69, #10, #38 |

### Epic: Editing operations

Clipboard, duplicate, nudge, align/distribute/tidy, z-order, group/frame, boolean ops, flatten, mask and small node commands.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #96 | `E1` | Clipboard core: copy, cut, paste, paste here, in place, over selection, replace | area:editing | M1 | #1, #19, #21, #20, #7, #18 |
| #97 | `E2` | Copy as SVG/PNG/CSS and copy/paste properties | area:editing | M1 | #1, #96, #44 |
| #98 | `E3` | Duplicate and repeat offset | area:editing | M1 | #1, #21, #20 |
| #99 | `E4` | Nudge with arrow keys | area:editing | M1 | #1, #21, #20, #39 |
| #82 | `E5` | Align, distribute and tidy up | area:editing | M1 | #1, #21, #20 |
| #100 | `E6` | Z-order commands | area:editing | M1 | #1, #21, #20 |
| #101 | `E7` | Group, ungroup and frame selection | area:editing | M1 | #1, #21, #20, #18 |
| #102 | `E8` | Boolean operations (PathOps) | area:editing | M1 | #1, #32, #21, #34 |
| #103 | `E9` | Flatten and outline stroke | area:editing | M1 | #1, #102, #43 |
| #104 | `E10` | Mask | area:editing | M1 | #1, #37, #21, #101 |
| #105 | `E11` | Quick node commands: flip, visibility, lock, opacity, swap fill/stroke, find | area:editing | M1 | #1, #21, #20, #7 |
| #106 | `E12` | SVG import: paste and drop to vector layers | area:editing | M1 | #1, #21, #34 |

### Epic: Panels as plugins (layers, pages, assets, design panel, pickers, inspect)

Every sidebar, toolbar and property section as plugins on `panels`/`inspectors`.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #74 | `P1` | Toolbar plugin: floating tool bar with grouped dropdowns | area:panels | M2 | #11, #17 |
| #75 | `P2` | Layers panel: tree, selection sync, expand/collapse, icons | area:panels | M2 | #1, #9, #20, #22 |
| #76 | `P3` | Layers panel: drag reorder and nesting | area:panels | M2 | #1, #75, #21 |
| #77 | `P4` | Layers panel: visibility, lock, rename, search/filter | area:panels | M2 | #1, #75 |
| #78 | `P5` | Pages panel | area:panels | M2 | #1, #9, #22, #8 |
| #79 | `P6` | Assets panel: local library of components and styles | area:panels | M3 | #1, #9, #8 |
| #80 | `P7` | Design panel shell: tabs, stacked sections, selection-aware rendering | area:panels | M2 | #1, #9, #10, #20 |
| #81 | `P8` | Shared inspector inputs: numeric scrub field, color swatch, dropdowns | area:panels | M2 | #10 |
| #83 | `P9` | Design section: position, alignment, rotation, flip | area:panels | M2 | #1, #80, #81, #82 |
| #84 | `P10` | Design section: dimensions and resizing (fixed/hug/fill, min/max, clip) | area:panels | M2 | #1, #80, #81 |
| #85 | `P11` | Design section: appearance (opacity, blend, corner radius, visibility, mask) | area:panels | M2 | #1, #80, #81 |
| #87 | `P12` | Design section: fill (paint list) | area:panels | M2 | #1, #80, #81, #86, #23 |
| #88 | `P13` | Design section: stroke | area:panels | M2 | #1, #87, #34 |
| #89 | `P14` | Design section: effects | area:panels | M2 | #1, #87, #37 |
| #90 | `P15` | Design section: typography | area:panels | M2 | #1, #80, #81, #42, #24 |
| #91 | `P16` | Design section: selection colors (find and replace) | area:panels | M2 | #1, #87 |
| #92 | `P17` | Page properties section (background, variables, styles, export rows) | area:panels | M2 | #1, #80, #81 |
| #86 | `P18` | Color picker popover | area:panels | M2 | #1, #5, #81, #44 |
| #93 | `P19` | Gradient editor | area:panels | M2 | #1, #86, #36, #38 |
| #94 | `P20` | Zoom menu in the top bar | area:panels | M2 | #39, #8 |
| #95 | `P21` | Inspect panel: code, measurements and ready-for-dev | area:panels | M2 | #1, #80, #23 |

### Epic: Command palette, shortcuts, menus and settings

Palette, keymap presets and editor, app and context menus, settings store and UI.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #130 | `CP1` | Command palette plugin | area:app | M2 | #6, #7, #5 |
| #132 | `CP2` | Keyboard shortcut system: presets, rebinding, conflict detection | area:app | M2 | #7, #131 |
| #133 | `CP3` | Shortcut panel and editor (Ctrl+Shift+?) | area:app | M2 | #132 |
| #135 | `CP4` | App menu: in-window menu bar and native Electron menu mirror | area:app | M2 | #8, #16, #7 |
| #136 | `CP5` | Context menus: canvas, layers, empty canvas contents | area:app | M2 | #8, #47, #75 |
| #131 | `CP6` | Settings: preferences store and generated settings UI | area:app | M2 | #16, #3 |

### Epic: Components, variants, styles and variables

Component sync engine and UI, variants and properties, styles, variables UI (resolution is in the document epic).

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #107 | `C1` | Component sync engine (materialized instances, touched groups) | area:components | M3 | #1, #2, #19, #21 |
| #108 | `C2` | Create component, create instance, detach (UI and commands) | area:components | M3 | #1, #107, #8, #48 |
| #109 | `C3` | Instance overrides: reset, push to main, go to main, restore main | area:components | M3 | #1, #108, #80 |
| #110 | `C4` | Component sets and variants | area:components | M3 | #1, #108 |
| #111 | `C5` | Component properties: boolean, text, instance swap, variant | area:components | M3 | #1, #110, #81 |
| #112 | `C6` | Swap instance and assets quick insert | area:components | M3 | #1, #108, #79 |
| #113 | `C7` | Styles: paint, text, effect and grid styles | area:components | M3 | #87, #79, #1 |
| #114 | `C8` | Variables: collections, modes and the variables modal | area:components | M3 | #1, #23, #81, #87 |

### Epic: Auto layout and constraints

Auto layout engine, panel section, inference, canvas handles, constraints.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #115 | `L1` | Auto layout engine core: stacks, gap, padding, alignment, hug/fill/fixed | area:layout | M3 | #1, #19, #43, #23 |
| #116 | `L2` | Auto layout: wrap, space-between, min/max, absolute positioning, strokes included | area:layout | M3 | #1, #115 |
| #117 | `L3` | Auto layout section in the design panel | area:layout | M3 | #1, #115, #80, #81, #84 |
| #118 | `L4` | Add/remove auto layout with inference | area:layout | M3 | #1, #115 |
| #119 | `L5` | Auto layout canvas handles and drop indicator | area:layout | M3 | #1, #115, #51, #38 |
| #120 | `L6` | Constraints engine and widget | area:layout | M3 | #1, #52, #84 |

### Epic: AI (harness, tools bridge, chat, features)

`@neoworks/harness` in main, document tools bridge, attributed undoable AI edits, chat panel and AI features.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #142 | `A1` | AI harness service in Electron main | area:ai | M4 | #15, #14, #131 |
| #143 | `A2` | Renderer `ai` service and IPC event stream | area:ai | M4 | #142, #16 |
| #144 | `A3` | Document tools bridge: read tree, selection, apply changes, run command | area:ai | M4 | #1, #143, #19, #23, #44, #6 |
| #145 | `A4` | AI edits as undoable, attributed change sets | area:ai | M4 | #1, #144, #21 |
| #146 | `A5` | AI chat panel plugin | area:ai | M4 | #143, #9, #145 |
| #147 | `A6` | Selection-scoped context and screenshot attachment | area:ai | M4 | #1, #144 |
| #148 | `A7` | Generate designs from a prompt | area:ai | M4 | #1, #144, #145, #115 |
| #149 | `A8` | Rename layers with AI | area:ai | M4 | #1, #144, #145, #136 |
| #150 | `A9` | AI search across layers and assets | area:ai | M4 | #1, #144, #130, #79 |
| #151 | `A10` | AI change review: preview, accept, reject | area:ai | M4 | #1, #145, #38 |
| #152 | `A11` | Natural-language command palette mode and batch operations | area:ai | M4 | #1, #130, #144, #145 |

### Epic: Third-party plugins

Disk discovery, manifest and contributes, worker host, declarative UI, permissions, Figma-compatible API subset, dev tooling.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #153 | `PL1` | Plugin discovery in main: built-in, user and project (with trust) | area:plugins | M5 | #14, #15 |
| #154 | `PL2` | Manifest schema and `contributes` lazy stubs | area:plugins | M5 | #153, #6, #8, #11 |
| #155 | `PL3` | Worker host: one Web Worker per plugin behind one fiber | area:plugins | M5 | #154 |
| #156 | `PL4` | Plugin API v1 (native): document, selection, events, commands over RPC | area:plugins | M5 | #1, #155, #19, #21, #20 |
| #157 | `PL5` | Declarative UI surface: JSON tree rendered by the host | area:plugins | M5 | #155, #9 |
| #158 | `PL6` | Plugin permissions and network allowlist | area:plugins | M5 | #156 |
| #159 | `PL7` | Figma-compatible `figma` API subset in the worker | area:plugins | M5 | #1, #156, #157 |
| #160 | `PL8` | Plugin storage: pluginData, sharedPluginData, clientStorage | area:plugins | M5 | #1, #156, #25 |
| #161 | `PL9` | Plugin manager UI and Resources search for plugins | area:plugins | M5 | #154, #158, #9 |
| #162 | `PL10` | Plugin development: hot reload, console, templates, typings | area:plugins | M5 | #156, #155 |

### Epic: Prototyping and presentation

Prototype panel, connections, runtime and presentation view.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #121 | `PR1` | Prototype panel: flows and interactions list | area:prototype | M6 | #1, #80, #2 |
| #122 | `PR2` | Prototype connection handles on canvas | area:prototype | M6 | #1, #121, #38 |
| #123 | `PR3` | Prototype runtime: navigation, overlays, scrolling, animations | area:prototype | M6 | #1, #121, #33, #23 |
| #124 | `PR4` | Presentation view: present, preview, device frame | area:prototype | M6 | #123, #16 |

### Epic: Export (PNG, JPG, SVG, PDF)

Export service, raster, SVG and PDF (custom CanvasKit build) and export UI.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #125 | `X1` | Export service and export settings model on nodes | area:export | M6 | #1, #44, #23, #19 |
| #126 | `X2` | PNG, JPG and WEBP export | area:export | M6 | #125 |
| #127 | `X3` | SVG export | area:export | M6 | #125 |
| #128 | `X4` | PDF export (custom CanvasKit build) | area:export | M6 | #125, #32 |
| #129 | `X5` | Export section and export dialog | area:export | M6 | #1, #125, #126, #80 |

### Epic: App shell and distribution

Window shell, tabs, home screen, packaging, crash and error isolation UI.

| # | Key | Title | Label | Milestone | Depends on |
|---|---|---|---|---|---|
| #137 | `AP1` | Window shell: frameless window, controls, window state | area:app | M0 | #14, #16, #5 |
| #138 | `AP2` | Window and file tabs: multiple documents | area:app | M2 | #27, #5 |
| #139 | `AP3` | Home screen and file browser | area:app | M2 | #28, #5 |
| #140 | `AP4` | Packaging with electron-builder | area:app | M6 | #27 |
| #141 | `AP5` | Crash and error isolation UI | area:app | M6 | #3, #5, #26 |

## Screenshots used

- `docs/references/mobbin/figma-editor/5329eafd.webp`
- `docs/references/mobbin/figma-editor/a97310ea.webp`
- `docs/references/mobbin/figma-editor/d0a486f5.webp`
- `docs/references/mobbin/figma-editor/f15524dd.webp`
- `docs/references/mobbin/figma-editor/b00037bd.webp`
- `docs/references/mobbin/figma-properties/63bfebbd.webp`
- `docs/references/mobbin/figma-properties/ce742de1.webp`
- `docs/references/mobbin/figma-components/3d28babf.webp`
- `docs/references/mobbin/figma-prototype/409e7458.webp`
- `docs/references/mobbin/figma-devmode/3c47f5c1.webp`
- `docs/references/mobbin/figma-files/50db3ddf.webp`
- `docs/references/mobbin/figma-ai/6037f383.webp`
- `docs/references/mobbin/flows/adding-an-auto-layout/02-63d88603.webp`
- `docs/references/mobbin/flows/copying-a-hex-color/02-d074cb54.webp`
- `docs/references/mobbin/flows/formatting-text/05-f72b5fbf.webp`
- `docs/references/mobbin/flows/export-an-asset/02-73932262.webp`
- `docs/references/mobbin/flows/renaming-layers-with-ai/02-774f11a3.webp`
- `docs/references/mobbin/flows/plugin-details/01-dd584fc4.webp`

## Known gaps and risks

- Grid auto layout (CSS-grid style), smart animate, widgets, FigJam/slides/sites, dynamic and brush strokes, team libraries and real-time collaboration are out of scope for this backlog.
- Per-document context isolation with `ctx.isolate` (tabs) is a spike (`AP2`); fallback is one window per document.
- Vector network representation and text style normalisation rules still depend on the needs-design issue (`DMO`).
- PDF export needs a custom CanvasKit build (`X4`); SVG export from CanvasKit is unverified (`X3`).
- Many interaction details are `[K]` (unverified) in `docs/research/interactions.md`; each affected issue carries a note.
