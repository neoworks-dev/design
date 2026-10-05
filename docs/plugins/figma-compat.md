# Figma compatibility layer

Existing Figma plugins run with no changes to their code. A plugin whose source mentions `figma` gets
a `figma` global in its worker (`src/lib/plugins/worker/figma/`), built on the native `design` API.
This page is the compatibility table: what is supported, what is not, and how the two differ.

Manifests are not Figma's: an app manifest has a lower-case `id`, `api: "1.0"` and `contributes`
(see `docs/research/plugin-api.md`). Only the plugin code is unmodified.

## How it works

- Figma's API is synchronous; the host is not. The layer keeps a **copy of the current page** (taken
  when the plugin starts) and answers reads from it. Writes change the copy at once and are sent to the
  host in batches as one `document.apply`, so `figma.createRectangle()` returns a node with its final
  id immediately.
- One launch of the plugin is **one undo step**: the run ends at `figma.closePlugin()`, or when the
  plugin stopped changing things for a moment.
- Launching the plugin again from its command re-runs the script (Figma does the same).
- Needs the `document:read`, `document:write` and `selection` permissions (and `storage` for plugin
  data and `clientStorage`).

## Differences you will notice

- Only the **current page** is mirrored: `getNodeByIdAsync` of a layer on another page answers `null`,
  other pages have no children, and `figma.currentPage` cannot be set.
- Changes the user makes while the plugin runs are not mirrored (the selection is, `selectionchange`).
- `figma.showUI(html)` is not supported: plugin UI is a declarative surface tree (`design.ui`).
  `figma.showUI(tree, { title, width, height })` shows a surface tree in a dialog, which is an
  extension of the Figma signature.
- `fills` and `strokes` accept SOLID paints only (one stroke); text has one fill (its color).
- `loadFontAsync` resolves without checking that the font is installed.
- `group` and `ungroup` use the nodes' unrotated bounds.

## Supported

### `figma`

- `apiVersion`
- `command`
- `editorType`
- `mixed`
- `root`
- `currentPage`
- `viewport.zoom`
- `viewport.scrollAndZoomIntoView`
- `createRectangle`
- `createEllipse`
- `createText`
- `createFrame`
- `createLine`
- `createPolygon`
- `createStar`
- `createComponent`
- `createSection`
- `group`
- `ungroup`
- `getNodeById`
- `getNodeByIdAsync`
- `loadFontAsync`
- `notify`
- `showUI (surface tree)`
- `closePlugin`
- `on / once / off (selectionchange, close)`
- `clientStorage`
- `commitUndo`

### Nodes

- `id`
- `type`
- `name`
- `parent`
- `removed`
- `visible`
- `locked`
- `opacity`
- `x`
- `y`
- `width`
- `height`
- `rotation`
- `resize`
- `resizeWithoutConstraints`
- `fills (SOLID)`
- `strokes (SOLID, one)`
- `strokeWeight`
- `cornerRadius`
- `clipsContent`
- `layoutMode / itemSpacing / padding* / alignment / sizing`
- `characters (TEXT)`
- `fontSize (TEXT)`
- `fontName (TEXT)`
- `children / appendChild / insertChild`
- `findAll / findOne / findChildren / findChild`
- `selection (page)`
- `remove`
- `clone`
- `getPluginData / setPluginData / getPluginDataKeys`
- `getSharedPluginData / setSharedPluginData / getSharedPluginDataKeys`
- `setRelaunchData / getRelaunchData`

## Not supported

Using these throws a `FigmaCompatError` naming the member and the reason. Members that are in neither
table read as `undefined`, so `if (figma.something)` feature detection keeps working.

### `figma`

| Member | Why |
| --- | --- |
| `fileKey` | documents have no file key |
| `currentUser` | there are no accounts |
| `activeUsers` | there are no accounts |
| `pluginId` | use design.pluginId |
| `createPage` | the plugin API cannot create pages yet |
| `createImage` | images cannot be created from plugins yet |
| `createImageAsync` | images cannot be created from plugins yet |
| `createVector` | vector networks cannot be built from plugins yet |
| `createBooleanOperation` | boolean operations cannot be built from plugins yet |
| `createComponentFromNode` | use createComponent |
| `createPaintStyle` | styles cannot be created from plugins yet |
| `createTextStyle` | styles cannot be created from plugins yet |
| `createEffectStyle` | styles cannot be created from plugins yet |
| `createGridStyle` | styles cannot be created from plugins yet |
| `flatten` | not available to plugins yet |
| `union` | not available to plugins yet |
| `subtract` | not available to plugins yet |
| `intersect` | not available to plugins yet |
| `exclude` | not available to plugins yet |
| `getLocalPaintStyles` | styles are not mirrored |
| `getLocalTextStyles` | styles are not mirrored |
| `getStyleById` | styles are not mirrored |
| `listAvailableFontsAsync` | fonts are managed by the app |
| `getFileThumbnailNodeAsync` | not available |
| `saveVersionHistoryAsync` | not available |
| `triggerUndo` | a plugin cannot undo; use design.commitUndo to split steps |
| `skipInvisibleInstanceChildren` | not needed |
| `ui` | plugin UI is a declarative surface, not an HTML iframe; use figma.showUI(tree) |
| `parameters` | parameter input is not available |
| `payments` | there is no payment system |
| `timer` | there is no timer |
| `codegen` | use design.codegen |
| `variables` | use design.document.variables() |
| `teamLibrary` | there are no team libraries |
| `util` | not available |
| `base64Encode` | use btoa |
| `base64Decode` | use atob |
| `viewport.center` | the camera is described by x, y and zoom; use design.viewport |
| `viewport.bounds` | the camera is described by x, y and zoom; use design.viewport |

### Nodes

| Member | Why |
| --- | --- |
| `effects` | effects cannot be edited from plugins yet |
| `exportAsync` | use the export commands |
| `exportSettings` | use the export commands |
| `constraints` | constraints cannot be edited from plugins yet |
| `reactions` | prototype interactions cannot be edited from plugins yet |
| `absoluteTransform` | derived geometry is not mirrored |
| `absoluteBoundingBox` | derived geometry is not mirrored |
| `absoluteRenderBounds` | derived geometry is not mirrored |
| `relativeTransform` | use x, y and rotation |
| `vectorNetwork` | vector networks cannot be edited from plugins yet |
| `vectorPaths` | vector networks cannot be edited from plugins yet |
| `booleanOperation` | boolean operations cannot be edited from plugins yet |
| `mainComponent` | component instances cannot be edited from plugins yet |
| `createInstance` | component instances cannot be created from plugins yet |
| `swapComponent` | component instances cannot be edited from plugins yet |
| `detachInstance` | component instances cannot be edited from plugins yet |
| `setTextStyleIdAsync` | styles cannot be applied from plugins yet |
| `setFillStyleIdAsync` | styles cannot be applied from plugins yet |
| `fillStyleId` | styles cannot be applied from plugins yet |
| `textStyleId` | styles cannot be applied from plugins yet |
| `setRangeFontName` | styled text ranges cannot be edited from plugins yet |
| `setRangeFontSize` | styled text ranges cannot be edited from plugins yet |
| `setRangeFills` | styled text ranges cannot be edited from plugins yet |
| `getRangeFontName` | styled text ranges are not mirrored |
| `getStyledTextSegments` | styled text ranges are not mirrored |
| `textAutoResize` | text sizing cannot be edited from plugins yet |
| `textAlignHorizontal` | text alignment cannot be edited from plugins yet |
| `lineHeight` | text metrics cannot be edited from plugins yet |
| `letterSpacing` | text metrics cannot be edited from plugins yet |
| `fontWeight` | use fontName |
| `insertFrom` | not available |
| `findAllWithCriteria` | use findAll with a callback |
| `findWidgetNodesByWidgetId` | widgets do not exist |
| `clearPluginData` | set the key to an empty string instead |
| `setPluginDataAsync` | use setPluginData |
| `getPluginDataAsync` | use getPluginData |
| `isMask` | masks cannot be edited from plugins yet |
| `maskType` | masks cannot be edited from plugins yet |
| `rescale` | scaling cannot be done from plugins yet |
