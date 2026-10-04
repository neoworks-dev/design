# Plugin Architecture: Figma and Penpot, and What the Clone Should Expose

Provenance: **[V]** verified this session from fetched docs; **[K]** prior knowledge.
Sources: https://developers.figma.com/docs/plugins/how-plugins-run/ , https://developers.figma.com/docs/plugins/manifest/ , https://developers.figma.com/docs/plugins/api/figma/ , https://developers.figma.com/docs/plugins/api/figma-ui/ , https://developers.figma.com/docs/plugins/api/properties/figma-on/ , https://developers.figma.com/docs/plugins/api/DocumentChange/ , https://developers.figma.com/docs/plugins/api/properties/nodes-setplugindata/ , https://developers.figma.com/docs/widgets/ , https://developers.figma.com/docs/plugins/plugin-quickstart-guide/ , https://help.penpot.app/plugins/ , https://help.penpot.app/plugins/create-a-plugin/ , https://doc.plugins.penpot.app/interfaces/Penpot.html , https://github.com/penpot/penpot-plugins (archived Jan 2026, merged into main repo).

---

## 1. Figma plugin architecture

### Two-realm model [V]
- **Main thread (sandbox)**: plugin `main` JS runs in a minimal JavaScript sandbox on the app's main thread (ES2020+, Promise/Map/Set/etc.) with **no browser APIs**: no `fetch`, `XMLHttpRequest`, `setTimeout` (a limited `setTimeout`/console exist for convenience in practice [K]), no DOM. It has the `figma` global and full document access.
- **UI iframe**: shown via `figma.showUI(html | __html__, {width, height, visible, title, themeColors, position})`. Full browser APIs (fetch, DOM, workers, WebGL...) but **no document access**.
- Communication: **only message passing**. Main -> UI: `figma.ui.postMessage(msg, {origin?})`; UI listens with `window.onmessage = e => e.data.pluginMessage`. UI -> main: `parent.postMessage({pluginMessage: msg, pluginId?}, '*')`; main listens `figma.ui.onmessage = (msg, props) => ...` or `figma.ui.on('message', ...)`. Messages are structured-cloned (JSON-ish, plus Uint8Array). [V]
- Lifecycle: plugin runs until `figma.closePlugin(message?)`; otherwise it stays alive indefinitely (user can cancel). `figma.on('close')` fires before shutdown. [V]
- `figma.ui` also has `show()`, `hide()`, `resize(w,h)` (min 70x0), `reposition`, `getPosition`, `close()`. [V]
- Network: UI iframe has origin `null`; CORS needs permissive headers. Network allowlist in manifest `networkAccess {allowedDomains, reasoning, devAllowedDomains}`; violations give CSP errors. [V]
- Performance modes: `documentAccess: "dynamic-page"` (required for new plugins [V]) means pages load lazily; `await figma.loadAllPagesAsync()` or `page.loadAsync()` before touching other pages; sync getters replaced by `*Async` variants (`getNodeByIdAsync`, `getStyleByIdAsync`, `setCurrentPageAsync`).

### Manifest fields [V]
`name`, `id`, `api` (version), `main`, `ui` (string or `{name: path}` map for multiple UIs), `documentAccess` (`dynamic-page`), `networkAccess`, `parameters` (quick-launch typed inputs) + `parameterOnly`, `editorType` (`figma | figjam | dev | slides | buzz`), `menu` (nested commands with `{name, command}` and separators; command string arrives as `figma.command`), `relaunchButtons` (`{command, name, multipleSelection}`), `enableProposedApi`, `enablePrivatePluginApi`, `build` (shell command run before load), `permissions` (`currentuser`, `activeusers`, `fileusers`, `payments`, `teamlibrary`), `capabilities` (`textreview`, `codegen`, `inspect`, `vscode`), `codegenLanguages`, `codegenPreferences`.

### `figma` global surface [V from API index]
- **State**: `apiVersion`, `command`, `pluginId`, `editorType`, `mode` (default|textreview|inspect|codegen|linkpreview|auth), `currentPage`, `root`, `currentUser`, `activeUsers`, `hasMissingFont`, `fileKey`, `viewport` (center, zoom, bounds, `scrollAndZoomIntoView(nodes)`), `skipInvisibleInstanceChildren`.
- **Selection**: `currentPage.selection` (get/set `SceneNode[]`), `currentPage.selectedTextRange`, `figma.getSelectionColors()`.
- **Creation**: `createRectangle/Ellipse/Polygon/Star/Line/Vector/Text/Frame/Component/ComponentSet?/Page/Slice/Section/Table/TextPath/CodeBlock`, `createComponentFromNode`, `createNodeFromSvg(svg)`, `createNodeFromJSXAsync`, `createImage(bytes)` / `createImageAsync(url)`, `createVideoAsync`.
- **Operations**: `group(nodes, parent, index)`, `ungroup`, `union/subtract/intersect/exclude(nodes, parent, index)`, `flatten(nodes)`, `transformGroup`, `combineAsVariants(components, parent)`, `getNodeByIdAsync`, `node.findAll/findOne/findChildren/findAllWithCriteria({types})`.
- **Styles**: `createPaintStyle/TextStyle/EffectStyle/GridStyle`, `getLocalPaintStylesAsync` etc., `getStyleByIdAsync`, `moveLocal*StyleAfter`.
- **Variables**: `figma.variables.createVariableCollection/createVariable/getLocalVariablesAsync/getVariableByIdAsync/setBoundVariableForPaint/...`.
- **Fonts**: `loadFontAsync`, `listAvailableFontsAsync`, `getFontFamilyVariationAxes`.
- **Misc**: `notify(msg, {timeout, error, button})`, `openExternal(url)`, `clientStorage.getAsync/setAsync/deleteAsync/keysAsync` (per-plugin local storage), `commitUndo()`, `triggerUndo()`, `saveVersionHistoryAsync`, `base64Encode/Decode`, `getImageByHash`, `teamLibrary` (import library components/variables), `payments`, `parameters`, `timer`, `codegen`, `annotations`.
- **Node methods** [K]: `clone()`, `remove()`, `resize/resizeWithoutConstraints/rescale`, `exportAsync({format, constraint, contentsOnly, useAbsoluteBounds, svgOutlineText})`, `getCSSAsync()`, `getPluginData/setPluginData/getSharedPluginData/setSharedPluginData(namespace,key,value)/getPluginDataKeys`, `setRelaunchData/getRelaunchData`, `getMeasurements`, `getTopLevelFrame`, `insertChild`, `appendChild`, `setVectorNetworkAsync`, `createInstance()` (components), `swapComponent`, `detachInstance`, `resetOverrides`, `getMainComponentAsync`, `setBoundVariable(field, variable)`.
- `figma.mixed` symbol for heterogeneous values. `figma.loadFontAsync` before text edits. `figma.util`: `rgb()`, `solidPaint()`, `normalizeMarkdown()`. 

### Events [V]
`figma.on(type, cb)` / `once` / `off`:
- `selectionchange`, `currentpagechange`, `close`, `run` (`RunEvent {command, parameters}`), `drop` (`DropEvent {node, x, y, absoluteX, absoluteY, items, files}`; callback returns `false` to take over the drop), `documentchange`, `stylechange`, `textreview`, `timer*`.
- `documentchange`: `event.documentChanges: DocumentChange[]` with 6 types **CREATE, DELETE, PROPERTY_CHANGE, STYLE_CREATE, STYLE_DELETE, STYLE_PROPERTY_CHANGE**; each has `id`, `origin: 'LOCAL' | 'REMOTE'`, `node` (or `RemovedNode`), and `properties: NodeChangeProperty[]` (names of changed properties) for property changes. With dynamic-page access, a listener must be on a loaded page. [V]
- Events are batched per tick; this maps directly onto the clone's `Transaction.changes`.

### Data storage [V]
- `setPluginData(key, value)`: private to the plugin id, stored on any node/style/document, string values only (JSON.stringify non-strings), empty string deletes the key, **entry size cap 100 kB** (pluginId+key+value). Stored for stability, not security.
- `setSharedPluginData(namespace, key, value)`: readable by any plugin knowing namespace+key [K].
- `figma.clientStorage`: per-plugin storage on the user's machine, not synced with file; async; ~1MB-ish quota [K].
- `setRelaunchData({command: 'Description'})` on a node/page/document: shows a button in the Design panel that re-launches the plugin with `figma.command = command` on that node; manifest `relaunchButtons` declares the buttons. [V manifest, K behavior]

### Widgets [V]
Widgets are objects that live in the file and render for **all collaborators**, written in TSX with a React-like API (`widget.register(Component)`, `useSyncedState`, `useSyncedMap`, `usePropertyMenu`, `useEffect`, `AutoLayout`, `Text`, `Rectangle`...). State is synced via multiplayer (stored on the WidgetNode). They can open an iframe UI (`waitForTask`) and call the Plugin API. For the clone: widgets = "live nodes": a NODE type whose render tree is produced by a plugin component with persisted state. Defer to v2.

### Other plugin kinds [K]
Codegen (Dev Mode panel produces code strings per language), Inspect plugins, Text review (spellcheck), Link preview/auth for FigJam, VS Code. 

### Review/publishing and security [K]
Plugins reviewed on publish; permissions declared; sandbox exists because plugins are untrusted third-party code running next to user documents. Figma's sandbox is a realm (Realms/QuickJS-wasm compiled originally; Figma moved to a QuickJS-based sandbox) [K; see https://www.figma.com/blog/an-update-on-plugin-security/].

---

## 2. Penpot plugin architecture

[V] Plugins run as **separate iframes** (UI) and communicate via message passing; plugin logic (`plugin.js`) is loaded by the Penpot runtime and sandboxed using SES `Compartment` (Agoric hardened JS) with a controlled `penpot` global [V partial: repo refs SES/Compartment].
- Manifest (`manifest.json`) [V]: `name`, `description`, `code` (path to compiled JS), `icon` (56x56), `version: 2` (relative paths), `permissions` list: `content:read`, `content:write`, `library:read`, `library:write`, `user:read`, `comment:read`, `comment:write`, `allow:downloads`, `allow:localstorage` (write implies read). Hosted at a URL; installed by pasting the manifest URL into the Plugin Manager (Ctrl+Alt+P). For local dev, serve over HTTP.
- UI/messaging [V]: `penpot.ui.open(title, url, {width, height})`; plugin->UI `penpot.ui.sendMessage(msg)`; UI->plugin `parent.postMessage(msg, origin)`; both sides use `window`'s `message` event / `penpot.ui.onMessage(cb)`.
- `penpot` global [V]: properties `ui`, `utils`, `version`, `root`, `currentFile`, `currentPage`, `viewport`, `flags`, `history`, `library` (local + connected), `fonts`, `currentUser`, `activeUsers`, `theme`, `localStorage`, `selection`. Methods: create `createRectangle/createBoard/createEllipse/createPath/createText/createBoolean/createPage`, `group/ungroup/flatten`, `alignHorizontal/alignVertical/distributeHorizontal/distributeVertical`, `createShapeFromSvg(WithImages)`, `uploadMediaUrl/Data`, `generateMarkup/generateStyle/generateFontFaces`, `openPage/openViewer/closePlugin`, `shapesColors/replaceColor`, `createVariantFromComponents`, `waitForLayoutUpdate`. Events via `penpot.on(type, cb, props?)`: `pagechange`, `filechange`, `selectionchange`, `themechange`, `shapechange` (per shape), `contentsave`, `finish`. [V]
- Shapes are proxy objects (`Board`, `Rectangle`, `Ellipse`, `Path`, `Text`, `Group`, `Boolean`, `Image`, `SvgRaw`) mapping onto the internal immutable shape map; mutating a property schedules a `:mod-obj` change through the normal change pipeline (so undo works). `plugin-data` on shapes/pages/files (`setPluginData`, `setSharedPluginData`) persisted through `:set-plugin-data` change. [V for change type]
- Penpot also exposes theme changes, a `penpot.history` for undo grouping (`undoBlockBegin/End`), and library APIs (colors, typographies, components) [K].

### Comparison

| Aspect | Figma | Penpot |
|---|---|---|
| Code isolation | Sandboxed JS realm, no DOM | SES Compartment, hardened `penpot` object |
| UI | iframe, `figma.showUI` | iframe, `penpot.ui.open` |
| Messaging | `figma.ui.postMessage` / `parent.postMessage({pluginMessage})` | `penpot.ui.sendMessage` / `parent.postMessage` |
| Permissions | manifest `permissions`, `networkAccess` | manifest `permissions` (`content:*`, `library:*` ...) |
| Events | `figma.on(...)`, `documentchange` with granular property list | `penpot.on(...)`, `shapechange` per shape |
| Storage | pluginData (100kB), sharedPluginData, clientStorage | plugin-data, localStorage proxy (permission) |
| Distribution | Community review | Manifest URL |
| Undo | `commitUndo` | `history.undoBlockBegin/End` |

---

## 3. What the clone's plugin system should expose

The project already has `@neoworks/extension-system` (see repo skill `extension-system`): a plugin kernel with revertible effects (`ctx.effect`), services (`inject/provide`), five event dispatch modes and isolate/intercept. The design should compose with it instead of cloning Figma's model 1:1.

1. **Two surfaces, one API**: (a) *Figma-compatible `figma` facade* (subset of the above) so existing plugins can run with minimal changes; (b) a richer *native* API built on the extension system (services: `DocumentService`, `SelectionService`, `ViewportService`, `CommandService`, `ToolService`, `PanelService`, `ExportService`, `AiService`, `StorageService`).
2. **Isolation**: run plugin main code in a separate realm: Electron utility process or a `QuickJS-wasm`/`vm` sandbox with a hardened global; plugin UI in sandboxed `<iframe sandbox="allow-scripts">` with `srcdoc` or custom `plugin://` protocol, no node integration, context isolation on. Messages relayed by a typed bridge with structured clone. Offline app means no CSP network limits by default, but keep a `networkAccess` allowlist enforced by an Electron session `webRequest` filter, and ask permission for filesystem.
3. **Permissions**: manifest-declared (`document:read`, `document:write`, `selection`, `network`, `fs`, `clipboard`, `ai`, `ui:panel`, `ui:tool`, `storage`), prompted on first run, enforced at the bridge.
4. **Transactional edits**: every plugin run opens a Transaction (origin 'plugin', label = plugin name) and is one undo step unless `commitUndo()` is called; dispose via `ctx.effect` makes unloading a plugin revert its UI/tool registrations. Document mutation is *not* reverted on unload (it is user data).
5. **Events**: `selectionchange`, `currentpagechange`, `documentchange` (with `{type: CREATE|DELETE|PROPERTY_CHANGE|STYLE_*, id, origin: LOCAL|REMOTE|PLUGIN|AI, properties[]}`), `run`, `drop`, `close`, `viewportchange`, `toolchange`, `beforesave`/`aftersave`, `timer`. Support interception ("before delete") via the extension-system `intercept` mode, which Figma lacks.
6. **Node API** mirroring Figma names/enums (see data-model.md schema) with `figma.mixed`, async loaders optional, plus `node.toJSON()` and `figma.query(selector)`.
7. **Storage**: `pluginData` (private, 100kB limit as Figma), `sharedPluginData(namespace)`, `clientStorage` (backed by a per-plugin SQLite/JSON file in app data), plus `relaunchData`.
8. **Extension points beyond Figma**: custom tools (pointer events + overlay drawing), custom inspector panels/sections in the right sidebar, custom node types (a widget-like node with plugin-provided renderer and synced state), custom layout algorithms, custom paint/effect types (shader plugins), import/export format handlers (SVG, Sketch, .fig, Lottie), command palette entries and keybindings, context-menu items, AI tool registration (functions that the AI agent can call), design-token transformers, codegen providers.
9. **AI as plugin consumer**: expose the same API as MCP-style tool schemas (`create_node`, `set_props`, `query`, `export_png`, `apply_layout`) so the built-in assistant and third-party agents use identical, permission-checked capabilities.
10. **Headless mode**: the document model and API must run without the renderer (Node/Electron main) for tests, batch plugins, CLI export (Penpot's `render-wasm` has a headless export build; Figma REST plays that role).
11. **Versioning**: manifest `api: "1.x"`; keep stable enum spellings; deprecations carry warnings.
12. **Developer experience**: `@neoworks/plugin-typings` package, hot reload (Figma's `build` manifest command + watch), plugin devtools console, template generator.
