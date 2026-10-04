# Data Model Dossier: Figma and Penpot

Provenance legend: **[F]** verified this session against fetched Figma docs; **[P]** verified against Penpot source/docs; **[K]** from prior knowledge of the public docs or API and not re-fetched. Check [K] items against the linked docs before relying on exact enum spellings.

Primary sources:
- Plugin API nodes: https://developers.figma.com/docs/plugins/api/nodes/
- REST node types: https://developers.figma.com/docs/rest-api/file-node-types/
- REST property types: https://developers.figma.com/docs/rest-api/file-property-types/
- Auto layout: https://developers.figma.com/docs/plugins/api/properties/nodes-layoutmode/
- Text: https://developers.figma.com/docs/plugins/api/TextNode/
- Component properties: https://developers.figma.com/docs/plugins/api/ComponentPropertyDefinitions/
- Multiplayer: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Vector networks: https://www.figma.com/blog/introducing-vector-networks/
- Penpot shape: https://github.com/penpot/penpot/blob/develop/common/src/app/common/types/shape.cljc
- Penpot changes: https://github.com/penpot/penpot/blob/develop/common/src/app/common/files/changes.cljc
- Penpot components: https://github.com/penpot/penpot/blob/develop/common/src/app/common/types/component.cljc

---

## 1. Document structure

```
DOCUMENT (root, one per file)
  └─ PAGE / CANVAS (n)       background color, prototype start/flow starting points, guides
       └─ SceneNode tree (frames, groups, shapes, ...)
```

- Plugin API: `DocumentNode` -> `PageNode` -> `SceneNode` [F]. `figma.root` is the document, `figma.currentPage` the active page. The REST JSON calls the page type `CANVAS` [F].
- Every node has: `id` (string, `"pageIndex:counter"` style, e.g. `"12:34"`; instance children get composite ids `I<instanceId>;<sourceId>`), `name`, `type`, `visible`, `locked`, `parent`, and (for container nodes) `children` ordered back-to-front (index 0 = bottom of z-order) [K].
- Figma node types per plugin docs (40 listed) [F]: BooleanOperation, CodeBlock, Component, ComponentSet, Connector, Document, Ellipse, Embed, Frame, Group, Highlight, Instance, InteractiveSlideElement, Line, LinkUnfurl, Media, Page, Polygon, Rectangle, Removed, Section, ShapeWithText, Slice, SlideGrid, Slide, SlideRow, Slot, Stamp, Star, Sticky, TableCell, Table, Text, TextPath, TransformGroup, Vector, WashiTape, Widget.
- REST file JSON lists 25 types [F]: DOCUMENT, CANVAS, FRAME, GROUP, SECTION, VECTOR, RECTANGLE, ELLIPSE, STAR, LINE, REGULAR_POLYGON, BOOLEAN_OPERATION, TEXT, TEXT_PATH, TABLE, TABLE_CELL, COMPONENT, COMPONENT_SET, INSTANCE, STICKY, SHAPE_WITH_TEXT, CONNECTOR, WASHI_TAPE, SLICE, TRANSFORM_GROUP. Note the naming gap: REST `REGULAR_POLYGON` is Plugin `POLYGON`; REST `CANVAS` is Plugin `PAGE`.
- Design-only scope for the clone (skip FigJam, Slides, Buzz, Widgets): DOCUMENT, PAGE, FRAME, GROUP, SECTION, RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, VECTOR, TEXT, BOOLEAN_OPERATION, COMPONENT, COMPONENT_SET, INSTANCE, SLICE. Add TEXT_PATH and TRANSFORM_GROUP later. A SLOT node type is new (slot component property).

### Mixin architecture [F]
Figma does not use inheritance. Properties are grouped in mixins and each node type implements a subset (e.g. `ChildrenMixin` is on Frame, Page, Group but not Rectangle). The clone should do the same: capabilities as composable interfaces, with a table mapping node type to mixins.

| Mixin | Key properties [K unless noted] |
|---|---|
| BaseNodeMixin | id, parent, name, removed, pluginData, sharedPluginData, relaunchData, componentPropertyReferences, boundVariables, explicitVariableModes |
| SceneNodeMixin | visible, locked, stuckNodes, attachedConnectors, componentPropertyReferences, isAsset |
| ChildrenMixin | children, appendChild, insertChild, findChild(ren), findAll, findOne, findAllWithCriteria |
| LayoutMixin | x, y, width, height, rotation, relativeTransform, absoluteTransform, absoluteBoundingBox, absoluteRenderBounds, resize, resizeWithoutConstraints, rescale, minWidth/maxWidth/minHeight/maxHeight, layoutAlign, layoutGrow, layoutPositioning, layoutSizingHorizontal/Vertical, layoutSizingHorizontal, constrainProportions (aspect lock), targetAspectRatio |
| GeometryMixin | fills, strokes, strokeWeight, strokeAlign, strokeCap, strokeJoin, strokeMiterLimit, dashPattern, strokeGeometry, fillGeometry, fillStyleId, strokeStyleId, outlineStroke(), strokeTopWeight/Right/Bottom/Left |
| BlendMixin | opacity, blendMode, isMask, maskType (ALPHA/VECTOR/LUMINANCE), effects, effectStyleId |
| CornerMixin | cornerRadius, cornerSmoothing, topLeftRadius, topRightRadius, bottomLeftRadius, bottomRightRadius |
| RectangleCornerMixin | per-corner radii |
| ConstraintMixin | constraints {horizontal, vertical} |
| ExportMixin | exportSettings[], exportAsync() |
| FramePrototypingMixin | overflowDirection, numberOfFixedChildren, overlayPositionType, overlayBackground, overlayBackgroundInteraction |
| ReactionMixin | reactions[] |
| DefaultFrameMixin | everything for frames: clipsContent, guides, layoutGrids, gridStyleId, auto layout properties, + above |
| AutoLayoutMixin | layoutMode, layoutWrap, primaryAxis*, counterAxis*, padding*, itemSpacing, counterAxisSpacing, itemReverseZIndex, strokesIncludedInLayout [F for names] |
| MinimalBlendMixin, MinimalFillsMixin, MinimalStrokesMixin | used by Text range/style objects |
| PublishableMixin | description, descriptionMarkdown, documentationLinks, key, remote, getPublishStatusAsync |
| VariantMixin | variantProperties, variantGroupProperties |
| TextSublayerNode | text-specific, see section 6 |
| AnnotationsMixin, DevResourcesMixin | out of scope initially |

### Node type x mixin matrix (design nodes)

| Node | Children | Layout | Geometry (fills/strokes) | Blend/effects | Corner | Constraints | Export | AutoLayout | Notes |
|---|---|---|---|---|---|---|---|---|---|
| PAGE | yes | no | no | no | no | no | yes | no | backgrounds, flowStartingPoints, prototypeStart, guides |
| FRAME | yes | yes | yes | yes | yes | yes | yes | yes | clipsContent, layoutGrids, guides, reactions |
| GROUP | yes | yes | no (computed) | yes (opacity, blend, effects) | no | yes | yes | no | bounds auto-fit children; x/y/size derived |
| SECTION | yes | yes | fills, strokes | no | no | no | yes | no | `sectionContentsHidden`, `devStatus`; only top-level children frames/shapes; no constraints |
| RECTANGLE | no | yes | yes | yes | yes | yes | yes | no | |
| ELLIPSE | no | yes | yes | yes | no | yes | yes | no | `arcData {startingAngle, endingAngle, innerRadius}` |
| POLYGON | no | yes | yes | yes | yes | yes | yes | no | `pointCount` >= 3 |
| STAR | no | yes | yes | yes | yes | yes | yes | no | `pointCount`, `innerRadius` ratio |
| LINE | no | yes | strokes only | yes | no | yes | yes | no | height always 0, rotation encodes direction |
| VECTOR | no | yes | yes | yes | yes | yes | yes | no | `vectorNetwork`, `vectorPaths`, `handleMirroring` |
| TEXT | no | yes | yes (fills = text color) | yes | no | yes | yes | no | see 6 |
| BOOLEAN_OPERATION | yes (operands) | yes | yes | yes | yes | yes | yes | no | `booleanOperation` UNION/INTERSECT/SUBTRACT/EXCLUDE |
| COMPONENT | yes | yes | yes | yes | yes | yes | yes | yes | `componentPropertyDefinitions`, `key` |
| COMPONENT_SET | yes (components) | yes | yes | yes | yes | yes | yes | yes | frame-like, `componentPropertyDefinitions`, dashed purple outline |
| INSTANCE | yes (copies) | yes | yes | yes | yes | yes | yes | yes | `mainComponent`, `componentProperties`, `overrides`, `scaleFactor` |
| SLICE | no | yes | no | no | no | no | yes | no | export region only |

Behavioural details to implement:
- GROUP has no own fills or clipping; its box is the union of children bounds and is recomputed when children change. Frames own their size. A group inside an auto layout frame is a normal layout child.
- FRAME vs GROUP: frames clip (`clipsContent`), support auto layout, constraints for their children, layout grids, prototype overflow, and have a fills background. Top-level frames are "boards"/artboards.
- BOOLEAN_OPERATION result geometry is derived from children; children stay as editable operands. Fills/strokes belong to the boolean node.
- ELLIPSE with arcData is how arcs, pies and donuts are done (no separate node).

---

## 2. Paints, effects, strokes, blend modes

### Paint (fills and strokes both use `Paint[]`) [F for type list]
Types: `SOLID`, `GRADIENT_LINEAR`, `GRADIENT_RADIAL`, `GRADIENT_ANGULAR`, `GRADIENT_DIAMOND`, `IMAGE`, `EMOJI`, `VIDEO`, `PATTERN`.

Common: `type`, `visible` (default true), `opacity` (0..1), `blendMode`, `boundVariables` (color var binding on `color`).

- SOLID: `color {r,g,b}` each 0..1 floats (alpha is in `opacity` of the paint, RGBA only in the effect colors).
- Gradients [K]: `gradientTransform` (2x3 matrix mapping the node's unit square into the gradient's unit space: gradient is defined along x axis from (0,0.5) to (1,0.5) before transform; the REST API instead gives `gradientHandlePositions` three handles in normalized node space: start, end, width handle), `gradientStops[] {position 0..1, color {r,g,b,a}, boundVariables}`.
- IMAGE [K]: `imageHash` (SHA-1 of the bytes, content addressed), `scaleMode` FILL | FIT | CROP | TILE, `imageTransform` (for CROP, 2x3), `scalingFactor` (TILE), `rotation` (multiples of 90), `filters {exposure, contrast, saturation, temperature, tint, highlights, shadows}`.
- VIDEO, PATTERN, EMOJI: skip initially.
- Paint stack: array order is bottom to top (last element drawn on top). The panel shows reversed.

### Strokes [K, names F for the list in AutoLayout]
`strokes: Paint[]`, `strokeWeight` (number) or per-side `strokeTopWeight/BottomWeight/LeftWeight/RightWeight` (frames, rects), `strokeAlign` INSIDE | OUTSIDE | CENTER (frames/shapes; text and lines are center only), `strokeCap` NONE | ROUND | SQUARE | ARROW_LINES | ARROW_EQUILATERAL | TRIANGLE_FILLED | DIAMOND_FILLED | CIRCLE_FILLED (per vertex in vector networks via `strokeCap` on the vertex), `strokeJoin` MITER | BEVEL | ROUND, `strokeMiterLimit` (default 4), `dashPattern: number[]`, `strokesIncludedInLayout` (auto layout) [F].

### Effects [F for type list]
`INNER_SHADOW`, `DROP_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR`, plus newer `TEXTURE`, `NOISE`. Fields [K]:
- Shadows: `color {r,g,b,a}`, `offset {x,y}`, `radius` (blur), `spread`, `visible`, `blendMode`, `showShadowBehindNode` (drop shadow, for transparent shapes).
- Blur: `radius`, `blurType` NORMAL | PROGRESSIVE (with `startRadius`, `startOffset`, `endOffset`) [F].
- Effect order = array order; inner shadows render above fills, drop shadows below.

### Blend modes [K]
`PASS_THROUGH` (groups/frames only), `NORMAL`, `DARKEN`, `MULTIPLY`, `LINEAR_BURN`, `COLOR_BURN`, `LIGHTEN`, `SCREEN`, `LINEAR_DODGE`, `COLOR_DODGE`, `OVERLAY`, `SOFT_LIGHT`, `HARD_LIGHT`, `DIFFERENCE`, `EXCLUSION`, `HUE`, `SATURATION`, `COLOR`, `LUMINOSITY`. Pass-through means a frame/group does not create an isolated compositing layer; any other mode (or opacity < 1 in Figma for groups) isolates the subtree.

### Masks [K]
`isMask` on a node masks all following siblings (above it in z order) until the end of the same container; `maskType` ALPHA | VECTOR | LUMINANCE. Mask + siblings are usually wrapped in a group ("Use as mask" on selection groups them). Penpot instead puts the mask as the first child of a group with `masked-group? true`.

---

## 3. Transforms and bounds

- `relativeTransform: [[a,c,tx],[b,d,ty]]` (2x3 affine) is relative to the parent. For GROUP/FRAME parents the origin is the parent's top-left corner (parent's own rotation is included in the parent's transform, not the child's) [F: "2x3 affine transformation matrix" for Transform].
- `x`, `y` are the translation components of relativeTransform (for a rotated node, x,y is the position of the *unrotated* local origin in the parent's coordinates, not the visual top-left). `rotation` in degrees (Figma reports CCW positive in the API, the UI shows the opposite sign convention. Pick one internal convention: radians/matrix and convert at the API boundary).
- `absoluteTransform` = parent absoluteTransform x relativeTransform (page coordinates).
- `width`/`height` are the local, unrotated, unscaled size. Figma never stores scale in the matrix: resizing changes width/height and the matrix stays rotation + translation (+ flips as negative scale and skew only in imported or legacy data). Instances can carry `scaleFactor` (Scale tool, K).
- `absoluteBoundingBox` {x,y,width,height}: axis-aligned bounds of the rotated shape in page space, **excludes** strokes (outside) and effects.
- `absoluteRenderBounds`: axis-aligned bounds including stroke, shadows, blur (what is actually painted); null when invisible.
- Flip = negative scale component in the matrix (a or d = -1).
- Rotation handling: rotation rotates about the node center in the UI, but is stored as matrix about the local origin, so the translation is recomputed. Children of a rotated frame store transforms relative to the rotated frame (they do not change when the parent rotates).
- Constraints and auto layout operate in the parent's local space and ignore parent rotation.
- Clone recommendation: store `transform` as 6 numbers `[a,b,c,d,e,f]` + `width`,`height`; derive `x,y,rotation`; cache absolute transform and bounds in a dirty-flag spatial index.

Penpot comparison [P]: shapes store `x y width height rotation`, `selrect` (axis-aligned rect), `points` (4 corner points after transform), `transform` and `transform-inverse` (matrix), so geometry is redundant but fast for hit-testing. Rotation of a group recomputes children's transforms.

---

## 4. Vector networks vs paths

Figma [F]: A **vector network** allows edges between any two vertices (graph, not a single chain), so it supports branching points, fills of enclosed regions without winding-rule concepts, and stroke caps/joins at junctions.

`VectorNetwork` [K]:
```ts
vertices: { x: number; y: number; strokeCap?: StrokeCap; strokeJoin?: StrokeJoin;
            cornerRadius?: number; handleMirroring?: HandleMirroring }[]
segments: { start: number; end: number;            // vertex indices
            tangentStart?: {x,y}; tangentEnd?: {x,y} // cubic handles, RELATIVE to the vertex; absent = straight line
          }[]
regions?: { windingRule: 'NONZERO'|'EVENODD'; loops: number[][];   // each loop is a list of segment indices
            fills?: Paint[]; fillStyleId?: string }[]
```
- `handleMirroring`: NONE | ANGLE | ANGLE_AND_LENGTH (per vertex).
- `vectorPaths`: `{windingRule, data: string}[]` where data is an SVG path string (read via `vectorPaths`, set with `setVectorNetworkAsync`). `fillGeometry` / `strokeGeometry` give the computed outline path data (`{path, windingRule}[]`).
- Vector node coordinates are relative to the node's own box; vertices are in local space.
- If `regions` is absent, fills are computed from closed loops automatically.
- Primitive shapes (rect, ellipse, polygon, star, line) are parametric and become vectors on **flatten** (Cmd+E) or when edited in vector edit mode (rect edit converts to vector).

Penpot [P]: `:path` shapes store `content`, a vector of path commands in SVG-like form: `{:command :move-to|:line-to|:curve-to|:close-path, :params {:x :y :c1x :c1y :c2x :c2y}}`. No networks: a single or multi-subpath model. Penpot's boolean node and path are separate types.

Recommendation: implement the network as the canonical internal vector format (superset), import SVG paths by splitting into segments, and export to path strings with a loop tracer. Keep `windingRule` per region.

---

## 5. Auto layout (flex) and grid

Properties [F names from layoutmode page]:

Container (FRAME, COMPONENT, COMPONENT_SET, INSTANCE):
- `layoutMode`: `NONE | HORIZONTAL | VERTICAL | GRID`. Switching on auto layout re-positions children and cannot be restored by toggling off [F].
- `layoutWrap`: `NO_WRAP | WRAP` (horizontal only in the original, now both) [K].
- `primaryAxisSizingMode`, `counterAxisSizingMode`: `FIXED | AUTO` (AUTO = hug contents) [K].
- `primaryAxisAlignItems`: `MIN | CENTER | MAX | SPACE_BETWEEN`.
- `counterAxisAlignItems`: `MIN | CENTER | MAX | BASELINE`.
- `counterAxisAlignContent`: `AUTO | SPACE_BETWEEN` (for wrapped rows) [F name].
- `itemSpacing` (gap along primary axis), `counterAxisSpacing` (gap between wrapped rows; null = same as itemSpacing) [F].
- `paddingTop/Right/Bottom/Left` [F].
- `itemReverseZIndex` (first child on top), `strokesIncludedInLayout` [F].
- `clipsContent`.
- Min/max: `minWidth`, `maxWidth`, `minHeight`, `maxHeight` on frames or children in auto layout [K].

Child properties [K]:
- `layoutSizingHorizontal` / `layoutSizingVertical`: `FIXED | HUG | FILL` (HUG on containers and text; FILL = flex-grow on the primary axis / stretch on the counter axis). These unify the older `layoutGrow` (0 or 1) and `layoutAlign` (`INHERIT | STRETCH | MIN | CENTER | MAX`).
- `layoutPositioning`: `AUTO | ABSOLUTE`. ABSOLUTE children are ignored by layout, positioned with constraints against the frame, and keep their z-order.
- `layoutAlign`, `layoutGrow` legacy.
- Text and children with aspect ratio lock respect `targetAspectRatio`.

Algorithm (implementable, flexbox subset):
1. Collect AUTO-positioned, visible children (hidden children are skipped by default).
2. Resolve child sizes: FIXED = own size, HUG = intrinsic (container: recursive content size, text: measured), FILL = distribute remaining primary-axis space equally among FILL children (after respecting min/max), stretch counter axis to container inner size.
3. Place along the primary axis with gap or distribute with SPACE_BETWEEN (gap becomes computed and displayed as "Auto").
4. Wrap: break lines when the sum exceeds the available primary size (fixed-size container required), each line uses counter-axis alignment, `counterAxisSpacing` between lines.
5. HUG container size = content + padding (+ strokes if `strokesIncludedInLayout`).
6. Layout is bottom-up for HUG, top-down for FILL; iterate to fixpoint, or topologically (two passes).
Quirks: a HUG container with FILL child on the same axis degenerates (child acts as hug), absolute children do not contribute to hug size, resizing a HUG axis by hand switches that axis to FIXED, dragging a child in a layout reorders it (drop indicator), Shift+A toggles, and Ctrl+Alt+A... (see interactions.md).

Grid layout [F: `layoutMode: 'GRID'`]: Figma added GRID auto layout in 2025. Properties (K, verify at https://developers.figma.com/docs/plugins/api/properties/nodes-gridrowcount/): `gridRowCount`, `gridColumnCount`, `gridRowGap`, `gridColumnGap`, `gridRowSizes[]` and `gridColumnSizes[]` (each `{type: FLEX|FIXED|HUG, value}`), and child `gridRowSpan`, `gridColumnSpan`, `gridRowAnchorIndex`, `gridColumnAnchorIndex`, `gridChildHorizontalAlign`, `gridChildVerticalAlign`. Penpot has CSS-grid layout with `layout-grid-rows` and `layout-grid-columns` tracks (`{type :flex|:fixed|:percent|:auto, value}`) and children `layout-cell` with row/column/spans [P/K].

Penpot flex [P/K]: frame attrs `layout :flex|:grid`, `layout-flex-dir :row|:reverse-row|:column|:reverse-column`, `layout-gap {:row-gap :column-gap}`, `layout-gap-type`, `layout-wrap-type :wrap|:nowrap`, `layout-padding-type :simple|:multiple`, `layout-padding {:p1 :p2 :p3 :p4}`, `layout-justify-content`, `layout-justify-items`, `layout-align-content`, `layout-align-items`; child attrs `layout-item-margin`, `layout-item-margin-type`, `layout-item-h-sizing :fix|:fill|:auto`, `layout-item-v-sizing`, `layout-item-max-h/min-h/max-w/min-w`, `layout-item-absolute`, `layout-item-z-index`, `layout-item-align-self`. Penpot supports child margins, which Figma does not.

### Layout grids (guides, not auto layout) [F type list: COLUMNS, ROWS, GRID]
`layoutGrids: LayoutGrid[]` on frames: `{pattern: 'GRID'|'COLUMNS'|'ROWS', visible, color, sectionSize (GRID), alignment: MIN|MAX|CENTER|STRETCH, gutterSize, offset, count}`. Plus `guides: Guide[] {axis: 'X'|'Y', offset}` on frames and pages.

---

## 6. Constraints (non-auto-layout children)

`constraints: {horizontal, vertical}`, values: `MIN` (left/top), `MAX` (right/bottom), `CENTER`, `STRETCH` (left & right / top & bottom), `SCALE`. [K, REST docs use the same names.]
- Applied when the **parent frame is resized** (not when moved) and when it is resized by a plugin with `resize()`; `resizeWithoutConstraints()` skips them.
- Constraint is relative to the **nearest ancestor frame** (not group). Children of groups use the group's frame ancestor; group bounds update from children.
- Algorithm per axis with old parent size P0, new P1, child offset o and size s:
  - MIN: o same, s same. MAX: distance to far edge same: o' = o + (P1 - P0). CENTER: o' = o + (P1-P0)/2. STRETCH: o same, s' = s + (P1 - P0). SCALE: o' = o*P1/P0, s' = s*P1/P0.
- Ignored for children of auto layout frames (unless `layoutPositioning = ABSOLUTE`). Not available for top-level objects on the page, sections, or section children.
- Penpot: `constraints-h :left|:right|:leftright|:center|:scale`, `constraints-v :top|:bottom|:topbottom|:center|:scale` plus `fixed-scroll` for prototype [P/K].

---

## 7. Text model

[F from TextNode docs] Properties: `characters`, `textAutoResize` (`NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE`), `textTruncation` (`DISABLED | ENDING`), `maxLines`, `textAlignHorizontal` (LEFT, CENTER, RIGHT, JUSTIFIED), `textAlignVertical` (TOP, CENTER, BOTTOM), `paragraphIndent`, `paragraphSpacing`, `listSpacing`, `hangingPunctuation`, `hangingList`, `autoRename`, `hasMissingFont`, and per-character: `fontSize`, `fontName {family, style}`, `fontWeight`, `textCase` (`ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED`), `textDecoration` (`NONE | UNDERLINE | STRIKETHROUGH`) + `textDecorationStyle/Offset/Thickness/Color/SkipInk`, `letterSpacing {value, unit: PIXELS|PERCENT}`, `lineHeight {value, unit: PIXELS|PERCENT} | {unit: AUTO}`, `leadingTrim` (`NONE | CAP_HEIGHT`), `openTypeFeatures` (read-only map of tag -> bool, e.g. `SS01`, `LIGA`, `KERN`), `fills` per range, `hyperlink {type: URL|NODE, value}`, `textStyleId`, `fontVariations`, `listOptions {type: NONE|ORDERED|UNORDERED}`, `indentation`, `boundVariables`.

Model: a TEXT node = `characters: string` (UTF-16 indices in the plugin API) + style runs. Plugin API reads/writes by range: `getRangeFontSize(start,end)` returns the value or the symbol `figma.mixed` if the range is heterogeneous; `setRangeFontSize(...)`, and `getStyledTextSegments(fields[])` returns contiguous segments `{characters,start,end,...fields}`. Whole-node getters return `figma.mixed` when styles differ.
- Fonts must be loaded (`await figma.loadFontAsync(fontName)`) before mutating characters or style. Clone: do the same only if fonts are lazily loaded; otherwise optional.
- Auto-resize: `WIDTH_AND_HEIGHT` = auto width (single line grows, hug both), `HEIGHT` = auto height (fixed width, wraps), `NONE` = fixed box (overflow visible/clipped), `TRUNCATE` = deprecated, replaced by `textTruncation ENDING` + `maxLines`.
- Layout is computed by a shaping engine (HarfBuzz-like). Cache `position-data`: Penpot stores per-line/per-span rectangles for each text shape (`:position-data`), used for selection and SVG export [P].
- Recommended internal form: `paragraphs: Paragraph[]` each with `runs: {text, style}[]` plus paragraph props (align, indent, list). Convert to flat `characters + styleOverrideTable` for the plugin API/REST (Figma REST: `characters`, `characterStyleOverrides: number[]` (style key per character), `styleOverrideTable: {[key]: TypeStyle}`, `lineTypes[]`, `lineIndentations[]`) [K].
- Penpot [P]: `content` is a tree `{type: "root", children: [{type: "paragraph-set", children: [{type: "paragraph", children: [{text, font-family, font-size, font-weight, fills, ...}]}]}]}` (Draft.js heritage), shape attrs `grow-type :auto-width|:auto-height|:fixed`, `position-data`.

---

## 8. Components, instances, variants

### Figma [F/K]
- COMPONENT: a frame-like node that is the *main component*. `key` identifies it for library publishing. `componentPropertyDefinitions: {[name#id]: {type, defaultValue, variantOptions?, preferredValues?}}` where `type` is `BOOLEAN | TEXT | INSTANCE_SWAP | VARIANT` (and `SLOT`) [F].
- COMPONENT_SET: container of COMPONENT variants. Each variant is named `Prop=Value, Prop2=Value2`; the set's `componentPropertyDefinitions` has VARIANT entries with `variantOptions`; each variant has `variantProperties` map. `defaultVariant` is the first/chosen child.
- INSTANCE: `mainComponent` (reference), `componentProperties: {[name#id]: {type, value, preferredValues?}}`, `overrides: {id, overriddenFields[]}[]`, `isExposedInstance`, `exposedInstances`, `scaleFactor`. `swapComponent(c)`, `detachInstance()`, `resetOverrides()`.
- Property wiring: nodes inside the main component reference props via `componentPropertyReferences`: `{visible: 'Show icon#1:0', characters: 'Label#1:1', mainComponent: 'Icon#1:2'}`. BOOLEAN toggles `visible`, TEXT drives `characters`, INSTANCE_SWAP drives nested instance `mainComponent`. VARIANT picks which COMPONENT in the set the instance points to. Property keys are `Name#nodeId` (suffix is a stable id; VARIANT keys have no suffix).
- Instance children mirror the main component's tree. Child ids: `I<instance-id>;<main-child-id>` (nested: chained with `;`).
- **Overrides**: an instance stores only the *deltas* per child (keyed by the main child's id path): any property a user changed (fills, text characters, visibility, size in non-layout, layout props, nested instance swaps, ...). Un-overridden properties follow the main component (live sync). Resetting an override removes the delta. Overrides survive swaps when child names/structure match.
- Structure edits on instances are limited: you cannot add/delete/reorder layers in an instance (except via slots, where children can be inserted; or hide). Layout properties on instance's auto layout frame are overridable.
- Sync semantic: edit main -> all instances update for all non-overridden properties. Published libraries propagate through "Update" prompts per file.
- Variants reflow: instance switching variants keeps overrides by matching layer names.
- Nested instances: instance within component; inner instance can have its own overrides inside the outer main; outer instances can override the inner's properties again (deltas layered).
- Detach: replaces INSTANCE with FRAME copying current resolved properties.
- `figma.combineAsVariants(components, parent)` builds a set. Component set layout is a grid; variants are free-positioned within the set frame.

### Penpot [P]
- Library `components` map: `component-id -> {id, name, path, main-instance-id, main-instance-page, objects (tree), variant-id?, variant-properties?}` (in new versions, components store their own shape tree in `:objects` and main instance lives on a page).
- Instance (copy) shapes carry: `component-id`, `component-file`, `component-root` (true on the copy's root), `shape-ref` (id of the corresponding shape in the main), and `touched` (set of attribute *groups* modified locally, e.g. `:fill-group`, `:geometry-group`, `:content-group`, `:text-content-text`, `:swap-slot-<uuid>`) [P]. Main instance root has `main-instance true`.
- Sync: when main changes, a change processor walks copies and, for each shape, applies attributes unless its group is in `touched`. This is **group-level** override tracking (coarser than Figma's property-level), simple to implement and good enough: store `touched: Set<GroupName>` per copy shape. Attribute group mapping lives in `app.common.types.component` `sync-attrs`.
- Operations: `:set-touched`, `:set-remote-synced` (for shapes whose remote value was reset), and component changes `:add-component`, `:mod-component`, `:del-component`, `:restore-component`, `:purge-component` [P].
- Variants were added to Penpot in 2.x with `variant-id` and `variant-properties` on components and a variant container board.

Recommendation for the clone: implement Figma semantics (property-level deltas per child path) but store them like Penpot's touched model for sync cheapness: `overrides: Record<ChildPath, Partial<NodeProps>>` + `resolve(node)` computes effective props lazily. Keep child ids stable so deltas survive structural edits in the main.

---

## 9. Styles and variables

### Styles [F create APIs listed: Paint, Text, Effect, Grid]
A style is a named, publishable bundle: PaintStyle (paints[]), TextStyle (font, size, lineHeight, letterSpacing, case, decoration, paragraph*, leadingTrim, listSpacing, hangingX), EffectStyle (effects[]), GridStyle (layoutGrids[]). Nodes reference via `fillStyleId`, `strokeStyleId`, `textStyleId`, `effectStyleId`, `gridStyleId`. Styles have slash-delimited names for folders ("Brand/Primary/500") and `description`, `key`, `remote`, `boundVariables`. Detach = clear the id and keep the values. Penpot: library colors (`:colors`), typographies (`:typographies`) with `path`+`name`, and shapes reference via `fill-color-ref-id`, `fill-color-ref-file`, `typography-ref-id`.

### Variables [K; help doc fetch failed, see https://help.figma.com/hc/en-us/articles/15339657135383]
- `VariableCollection {id, name, modes: {modeId, name}[], defaultModeId, variableIds[], hiddenFromPublishing, remote, key}`.
- `Variable {id, name (slash grouping), resolvedType: BOOLEAN|FLOAT|STRING|COLOR, valuesByMode: {[modeId]: value | VariableAlias{type:'VARIABLE_ALIAS', id}}, scopes: VariableScope[] (ALL_SCOPES, TEXT_CONTENT, CORNER_RADIUS, WIDTH_HEIGHT, GAP, ALL_FILLS, FRAME_FILL, SHAPE_FILL, TEXT_FILL, STROKE_COLOR, STROKE_FLOAT, EFFECT_FLOAT, EFFECT_COLOR, OPACITY, FONT_FAMILY, FONT_STYLE, FONT_WEIGHT, FONT_SIZE, LINE_HEIGHT, LETTER_SPACING, PARAGRAPH_SPACING, PARAGRAPH_INDENT), codeSyntax {WEB, ANDROID, iOS}, description, hiddenFromPublishing}`.
- Aliases chain (variable -> variable) and must be acyclic and type-matching. Each mode has an independent value. Collections of the same shape may be extended (2025) with inherited overrides.
- Binding: `node.boundVariables: {[field]: VariableAlias | VariableAlias[]}`; bindable fields include `width, height, minWidth.., itemSpacing, counterAxisSpacing, paddingLeft..., topLeftRadius..., strokeWeight..., opacity, visible, characters (STRING), fontFamily/fontSize/fontWeight/lineHeight/letterSpacing, fills[i] (color), strokes[i], effects[i] props, layoutGrids[i], componentProperties (via property refs)`. Paints bind inside the paint object `fills[0].boundVariables.color`.
- Resolution: `node.resolvedVariableModes` and `explicitVariableModes: {[collectionId]: modeId}`: the mode used for a node is the nearest ancestor with an explicit mode for that collection, else the collection default. Set explicit modes on a frame to theme a subtree (light/dark).
- Prototyping uses variables too (set variable actions, conditionals).
- Penpot: **design tokens** (`:set-tokens-lib`, `:set-token`, `:set-token-set` changes [P]) with token sets, themes (a theme = set of active sets), types (color, dimension, spacing, sizing, borderRadius, opacity, typography, fontFamilies...), references `{group.token}`. Shapes store `applied-tokens {attr -> token-name}`. Penpot's model is W3C-DTCG-ish with sets+themes; Figma's is collections+modes. Clone: use collections+modes internally, import/export DTCG JSON.

---

## 10. Prototyping model [F type names in REST page]

- `reactions: Reaction[]` on nodes; `Reaction = {trigger: Trigger|null, actions: Action[]}` (the older `action` single form is deprecated).
- Triggers [F]: `ON_CLICK`, `ON_HOVER`, `ON_PRESS`, `ON_DRAG`, `AFTER_TIMEOUT {timeout}`, `MOUSE_ENTER/LEAVE/UP/DOWN {delay}`, `ON_KEY_DOWN {device, keyCodes}`, media triggers (`ON_MEDIA_HIT`, `ON_MEDIA_END`), `ON_CLICK` etc.
- Actions [F]: `BACK`, `CLOSE`, `URL {url, openInNewTab}`, `NODE {destinationId, navigation: NAVIGATE|SWAP|OVERLAY|SCROLL_TO|CHANGE_TO, transition, preserveScrollPosition, overlayRelativePosition, resetVideoPosition, resetScrollPosition, resetInteractiveComponents}`, `UPDATE_MEDIA_RUNTIME`, `SET_VARIABLE {variableId, variableValue}`, `SET_VARIABLE_MODE`, `CONDITIONAL {conditionalBlocks[]}`.
- Transitions [F]: `DISSOLVE`, `SMART_ANIMATE`, `SCROLL_ANIMATE`, `MOVE_IN`, `MOVE_OUT`, `PUSH`, `SLIDE_IN`, `SLIDE_OUT` (directional: LEFT/RIGHT/TOP/BOTTOM), each with `easing {type: EASE_IN|EASE_OUT|EASE_IN_AND_OUT|LINEAR|EASE_IN_BACK|EASE_OUT_BACK|EASE_IN_AND_OUT_BACK|CUSTOM_BEZIER|GENTLE|QUICK|BOUNCY|SLOW + easingFunctionCubicBezier|Spring}`, `duration` (seconds), `matchLayers` for smart animate.
- Frame props [K]: `overflowDirection` NONE | HORIZONTAL_SCROLLING | VERTICAL_SCROLLING | HORIZONTAL_AND_VERTICAL_SCROLLING (a frame bigger than its container scrolls its content; `numberOfFixedChildren` pins the topmost N children (fixed headers, sorted by z-order top)), `overlayPositionType` CENTER|TOP_LEFT|TOP_CENTER|TOP_RIGHT|BOTTOM_*|MANUAL, `overlayBackground`, `overlayBackgroundInteraction` NONE|CLOSE_ON_CLICK_OUTSIDE.
- Page level: `flowStartingPoints: {nodeId, name}[]`, `prototypeStartNode`, `prototypeBackgroundColor`, device frame settings.
- Smart animate: match layers by name between source and destination frames; interpolate position, size, opacity, fill, rotation etc.
- Interactive components: variant-change reactions (`CHANGE_TO` navigation within a component set).
- Penpot [P/K]: `interactions` vector on shapes: `{event-type :click|:mouse-enter|:mouse-leave|:after-delay, action-type :navigate|:open-overlay|:toggle-overlay|:close-overlay|:prev-screen|:open-url, destination, preserve-scroll, animation {animation-type :dissolve|:slide|:push, duration, easing, way :in|:out, direction}, overlay-position, overlay-pos-type, close-click-outside, background-overlay, url}`; page flows via `:set-flow`; `fixed-scroll` for fixed children [P].

---

## 11. Penpot data structure and change model (essential for undo)

### File model [P]
```
file {
  id, name, revn, vern, features (set),
  data {
    pages: [uuid...] (order),
    pages-index: {uuid -> page},
    components: {uuid -> component},
    colors, typographies, media (assets),
    tokens-lib,
  }
}
page { id, name, objects: {uuid -> shape} (FLAT map), options {background, grids, ...}, guides, flows, plugin-data }
```
Objects are a **flat map by id**; tree structure is expressed by each shape's `parent-id`, `frame-id` and ordered `shapes` vector on container shapes (children, bottom to top). A root frame with id `uuid/zero` (00000000-...) is the page root. This makes lookups O(1), diffs trivial and persistent structural sharing cheap (ClojureScript immutable maps).

Shape types [P]: `:frame :group :rect :circle :path :bool :text :image :svg-raw` (Penpot has no section/ellipse names: `:circle` is ellipse, board = frame with `parent == root`).

Common shape attrs [P]: `id name type parent-id frame-id x y width height rotation selrect points transform transform-inverse fills strokes opacity blend-mode shadow blur hidden blocked(=locked) proportion proportion-lock constraints-h/v r1..r4 (radii) exports flip-x flip-y masked-group? show-content (clip) hide-in-viewer interactions grow-type position-data content metadata plugin-data`.

`fills`: `[{fill-color "#fff", fill-opacity 1} | {fill-color-gradient {type :linear|:radial, start-x start-y end-x end-y width, stops:[{color offset opacity}]}} | {fill-image {id width height mtype}}]`; `strokes`: `{stroke-style :solid|:dotted|:dashed|:mixed|:none, stroke-alignment :center|:inner|:outer, stroke-width, stroke-color, stroke-opacity, stroke-cap-start, stroke-cap-end}`.

### Change/operation model [P: changes.cljc]
All edits are expressed as **changes** (forward) and the editor stores paired **undo-changes** (inverse), both plain data, so they can be replayed, persisted and sent to the backend/other clients. Change types verified [P]:
- Objects: `:add-obj {id, page-id|component-id, parent-id, frame-id, index, obj}`, `:mod-obj {id, page-id, operations: [...]}`, `:del-obj {id, page-id}`, `:mov-objects {parent-id, shapes[], index, page-id, ignore-touched}`, `:reorder-children {parent-id, shapes}`, `:reg-objects {shapes}` (recompute group/bool bounds), `:fix-obj`.
- Operations inside `:mod-obj`: `{:type :set, :attr :fills, :val v, :ignore-geometry? ..., :ignore-touched?}`, `:assign {value map}`, `:set-touched {touched}`, `:set-remote-synced {remote-synced}`.
- Pages: `:add-page`, `:mod-page`, `:del-page`, `:mov-page`.
- Library: `:add/mod/del-color`, `:add/mod/del-typography`, `:add/mod/del-component`, `:restore-component`, `:purge-component`, `:add/mod/del-media`, `:set-tokens-lib`, `:set-token`, `:set-token-set`, `:set-guide`, `:set-flow`, `:set-default-grid`, `:set-plugin-data`.
- `process-changes` applies a vector of changes to file data (pure function, shared between frontend, backend and tests: it lives in `common/`). It also tracks touched shapes via a dynamic `*touched-changes*` to maintain component sync flags.
- Frontend undo stack: each user action produces `{redo-changes, undo-changes, origin}`; a transaction groups changes (e.g. drag = one entry, committed on drop; intermediate drag frames use `commit-changes` with `:undo-group` / `:save-undo? false` and are coalesced). Undo applies the stored inverse changes and pushes to the redo stack; both are persisted to the backend as ordinary updates (`update-file` with revn, session id, changes) so collaborators see undo as a new edit.
- Consequence: Penpot's undo is **local per-user inverse changes**, not a global history; other users' edits interleave.

### Figma multiplayer approach [F]
- Document = tree of objects, each a map of property -> value. Server holds the authoritative state; clients send property changes; **last writer wins per (object, property)**, no OT.
- Child order: **fractional indexing** [F]: each child has a `position` fraction in the parent; inserting between a and b picks a value between them (Figma's actual implementation uses strings in a base-95 alphabet to avoid precision loss, similar to the `fractional-indexing` npm package by Rocicorp) [K]. Concurrent reorders do not conflict structurally; ties are broken by id/randomized suffix.
- Object ids = (clientId, localCounter) so offline creation never collides [F].
- Reparenting: parent link is a property on the child (no separate children list), and the server rejects cycles; losers get orphaned and cleaned up [F].
- Offline: clients buffer changes and replay on reconnect; text uses a different CRDT-ish approach (not the LWW object model) [K].
- **Undo (Figma)**: per-user, not global: a user's undo only reverts that user's own latest change *to the property values they set*, and is a new write (if someone else changed it later, the undo still wins locally and is broadcast). Granularity: "commit" boundaries (mouse up, key release, typing pause).

### What the offline clone should take from this
1. Flat node map keyed by id + `parentId` + `index` (fractional string) per child. Gives O(1) lookups, trivial reparenting, mergeable sync later, and cheap plugin edits.
2. All mutations go through a single `Command`/`Change` pipeline with inverse generation (Penpot style): `{type:'set', id, props:{k:[old,new]}}`, `add`, `delete`, `move`, `reorder`. Undo = apply inverse; transactions group a gesture.
3. Plugin edits use the same pipeline and are grouped as one undo step per plugin invocation (or `commitUndo()`) [F: `figma.commitUndo/triggerUndo`].
4. Property-level granularity of change records means future CRDT/LWW sync (Figma-style) is possible without redesign: keep a `(nodeId, prop)` last-write timestamp optionally.

---

## 12. Recommended TypeScript schema sketch

```ts
// ---------- primitives ----------
export type NodeId = string;            // uuid or "<client>:<counter>"
export type Mixed = typeof MIXED;       // sentinel symbol for heterogeneous text ranges
export const MIXED: unique symbol = Symbol('mixed');

export interface RGB { r: number; g: number; b: number }          // 0..1
export interface RGBA extends RGB { a: number }
export type Matrix2x3 = [[number, number, number], [number, number, number]]; // [[a,c,e],[b,d,f]]
export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

// ---------- variables ----------
export type VariableType = 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
export interface VariableAlias { type: 'VARIABLE_ALIAS'; id: string }
export interface Variable {
  id: string; name: string; collectionId: string; resolvedType: VariableType;
  valuesByMode: Record<string, boolean | number | string | RGBA | VariableAlias>;
  scopes: string[]; codeSyntax: Partial<Record<'WEB' | 'ANDROID' | 'iOS', string>>; description: string;
}
export interface VariableCollection {
  id: string; name: string; modes: { modeId: string; name: string }[]; defaultModeId: string;
  variableIds: string[]; parentCollectionId?: string;
}
export type BoundVariables = Partial<Record<string, VariableAlias | VariableAlias[]>>;

// ---------- paints / effects ----------
export type BlendMode = 'PASS_THROUGH' | 'NORMAL' | 'DARKEN' | 'MULTIPLY' | 'LINEAR_BURN' | 'COLOR_BURN'
  | 'LIGHTEN' | 'SCREEN' | 'LINEAR_DODGE' | 'COLOR_DODGE' | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT'
  | 'DIFFERENCE' | 'EXCLUSION' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';
interface PaintBase { visible: boolean; opacity: number; blendMode: BlendMode; boundVariables?: BoundVariables }
export interface SolidPaint extends PaintBase { type: 'SOLID'; color: RGB }
export interface ColorStop { position: number; color: RGBA; boundVariables?: BoundVariables }
export interface GradientPaint extends PaintBase {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  gradientTransform: Matrix2x3; gradientStops: ColorStop[];
}
export interface ImagePaint extends PaintBase {
  type: 'IMAGE'; imageHash: string; scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageTransform?: Matrix2x3; scalingFactor?: number; rotation?: 0 | 90 | 180 | 270;
  filters?: { exposure?: number; contrast?: number; saturation?: number; temperature?: number;
              tint?: number; highlights?: number; shadows?: number };
}
export type Paint = SolidPaint | GradientPaint | ImagePaint;

export type Effect =
  | { type: 'DROP_SHADOW' | 'INNER_SHADOW'; visible: boolean; color: RGBA; offset: Vec2; radius: number;
      spread: number; blendMode: BlendMode; showShadowBehindNode?: boolean; boundVariables?: BoundVariables }
  | { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; visible: boolean; radius: number;
      blurType?: 'NORMAL' | 'PROGRESSIVE'; startRadius?: number; startOffset?: Vec2; endOffset?: Vec2 };

export interface Stroke {
  paints: Paint[]; weight: number | { top: number; right: number; bottom: number; left: number };
  align: 'INSIDE' | 'OUTSIDE' | 'CENTER'; cap: string; join: 'MITER' | 'BEVEL' | 'ROUND';
  miterLimit: number; dashPattern: number[];
}

// ---------- mixin interfaces ----------
export interface BaseProps {
  id: NodeId; type: NodeType; name: string; parentId: NodeId | null;
  index: string;                     // fractional index among siblings (base-62/95 string)
  visible: boolean; locked: boolean;
  pluginData: Record<string, string>; sharedPluginData: Record<string, Record<string, string>>;
  relaunchData?: Record<string, string>;
  boundVariables?: BoundVariables; explicitVariableModes?: Record<string, string>;
}
export interface LayoutProps {
  transform: Matrix2x3;              // relative to parent
  width: number; height: number;
  minWidth: number | null; maxWidth: number | null; minHeight: number | null; maxHeight: number | null;
  constrainProportions: boolean;
  layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL'; layoutSizingVertical: 'FIXED' | 'HUG' | 'FILL';
  layoutPositioning: 'AUTO' | 'ABSOLUTE';
}
export interface BlendProps { opacity: number; blendMode: BlendMode; isMask: boolean;
  maskType: 'ALPHA' | 'VECTOR' | 'LUMINANCE'; effects: Effect[]; effectStyleId?: string }
export interface GeometryProps { fills: Paint[]; strokes: Stroke; fillStyleId?: string; strokeStyleId?: string }
export interface CornerProps { cornerRadius: number | [number, number, number, number]; cornerSmoothing: number }
export interface ConstraintProps {
  constraints: { horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
                 vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE' };
}
export interface ExportSetting { suffix: string; format: 'PNG' | 'JPG' | 'SVG' | 'PDF' | 'WEBP';
  constraint: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number } }
export interface AutoLayoutProps {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  layoutWrap: 'NO_WRAP' | 'WRAP';
  primaryAxisSizingMode: 'FIXED' | 'AUTO'; counterAxisSizingMode: 'FIXED' | 'AUTO';
  primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN';
  itemSpacing: number; counterAxisSpacing: number | null;
  paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number;
  itemReverseZIndex: boolean; strokesIncludedInLayout: boolean; clipsContent: boolean;
  grid?: { rows: GridTrack[]; columns: GridTrack[]; rowGap: number; columnGap: number };
}
export interface GridTrack { type: 'FLEX' | 'FIXED' | 'HUG'; value?: number }
export interface LayoutGrid { pattern: 'GRID' | 'COLUMNS' | 'ROWS'; visible: boolean; color: RGBA;
  sectionSize?: number; alignment?: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH'; gutterSize?: number; offset?: number; count?: number }
export interface Guide { axis: 'X' | 'Y'; offset: number }

// ---------- prototyping ----------
export type Trigger = { type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' }
  | { type: 'AFTER_TIMEOUT'; timeout: number }
  | { type: 'ON_KEY_DOWN'; device: 'KEYBOARD' | 'GAMEPAD'; keyCodes: number[] };
export type Transition = { type: 'DISSOLVE' | 'SMART_ANIMATE' | 'SCROLL_ANIMATE' | 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT';
  direction?: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'; duration: number; easing: { type: string; bezier?: [number, number, number, number] };
  matchLayers?: boolean };
export type Action =
  | { type: 'BACK' | 'CLOSE' } | { type: 'URL'; url: string; openInNewTab?: boolean }
  | { type: 'NODE'; destinationId: NodeId | null; navigation: 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SCROLL_TO' | 'CHANGE_TO';
      transition?: Transition; preserveScrollPosition?: boolean }
  | { type: 'SET_VARIABLE'; variableId: string; value: unknown };
export interface Reaction { trigger: Trigger | null; actions: Action[] }

// ---------- text ----------
export interface TextStyle {
  fontFamily: string; fontStyle: string; fontWeight: number; fontSize: number;
  letterSpacing: { value: number; unit: 'PIXELS' | 'PERCENT' };
  lineHeight: { value: number; unit: 'PIXELS' | 'PERCENT' } | { unit: 'AUTO' };
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  openTypeFeatures: Record<string, boolean>; fontVariations: Record<string, number>;
  fills: Paint[]; hyperlink?: { type: 'URL' | 'NODE'; value: string }; textStyleId?: string;
}
export interface TextRun { text: string; style: Partial<TextStyle> }  // delta over node default style
export interface Paragraph { runs: TextRun[]; align?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  indent?: number; spacingAfter?: number; list?: 'NONE' | 'ORDERED' | 'UNORDERED'; listLevel?: number }

// ---------- vectors ----------
export interface VectorVertex { x: number; y: number; strokeCap?: string; strokeJoin?: string;
  cornerRadius?: number; handleMirroring?: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH' }
export interface VectorSegment { start: number; end: number; tangentStart?: Vec2; tangentEnd?: Vec2 }
export interface VectorRegion { windingRule: 'NONZERO' | 'EVENODD'; loops: number[][]; fills?: Paint[] }
export interface VectorNetwork { vertices: VectorVertex[]; segments: VectorSegment[]; regions?: VectorRegion[] }

// ---------- components ----------
export type ComponentPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT' | 'SLOT';
export interface ComponentPropertyDefinition { type: ComponentPropertyType; defaultValue: boolean | string;
  variantOptions?: string[]; preferredValues?: { type: 'COMPONENT' | 'COMPONENT_SET'; key: string }[] }
export interface ComponentPropertyValue { type: ComponentPropertyType; value: boolean | string }
export type OverrideDelta = Partial<LayoutProps & BlendProps & GeometryProps & CornerProps & AutoLayoutProps> &
  { characters?: string; mainComponentId?: NodeId; textRuns?: Paragraph[] };

// ---------- nodes (discriminated union) ----------
export type NodeType = 'DOCUMENT' | 'PAGE' | 'FRAME' | 'GROUP' | 'SECTION' | 'RECTANGLE' | 'ELLIPSE' | 'POLYGON'
  | 'STAR' | 'LINE' | 'VECTOR' | 'TEXT' | 'BOOLEAN_OPERATION' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE' | 'SLICE';

type Shape = BaseProps & LayoutProps & BlendProps & ConstraintProps & { exportSettings: ExportSetting[]; reactions: Reaction[] };
export type FrameLike = Shape & GeometryProps & CornerProps & AutoLayoutProps & {
  layoutGrids: LayoutGrid[]; guides: Guide[]; overflowDirection: 'NONE' | 'HORIZONTAL_SCROLLING' | 'VERTICAL_SCROLLING' | 'HORIZONTAL_AND_VERTICAL_SCROLLING';
  numberOfFixedChildren: number; overlayPositionType?: string; overlayBackground?: unknown };

export type DocumentNode = { id: NodeId; type: 'DOCUMENT'; name: string; pageIds: NodeId[] };
export type PageNode = Pick<BaseProps, 'id' | 'name' | 'pluginData' | 'sharedPluginData'> & { type: 'PAGE';
  backgrounds: Paint[]; guides: Guide[]; flowStartingPoints: { nodeId: NodeId; name: string }[]; prototypeStartNodeId?: NodeId };
export type FrameNode = FrameLike & { type: 'FRAME' };
export type GroupNode = Shape & { type: 'GROUP' };                       // size derived
export type SectionNode = BaseProps & LayoutProps & GeometryProps & { type: 'SECTION'; sectionContentsHidden: boolean };
export type RectangleNode = Shape & GeometryProps & CornerProps & { type: 'RECTANGLE' };
export type EllipseNode = Shape & GeometryProps & { type: 'ELLIPSE'; arcData: { startingAngle: number; endingAngle: number; innerRadius: number } };
export type PolygonNode = Shape & GeometryProps & CornerProps & { type: 'POLYGON'; pointCount: number };
export type StarNode = Shape & GeometryProps & CornerProps & { type: 'STAR'; pointCount: number; innerRadius: number };
export type LineNode = Shape & GeometryProps & { type: 'LINE' };
export type VectorNode = Shape & GeometryProps & CornerProps & { type: 'VECTOR'; network: VectorNetwork };
export type TextNode = Shape & GeometryProps & {
  type: 'TEXT'; paragraphs: Paragraph[]; defaultStyle: TextStyle;
  textAutoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT'; textTruncation: 'DISABLED' | 'ENDING'; maxLines: number | null;
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'; leadingTrim: 'NONE' | 'CAP_HEIGHT' };
export type BooleanNode = Shape & GeometryProps & CornerProps & { type: 'BOOLEAN_OPERATION'; booleanOperation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE' };
export type ComponentNode = FrameLike & { type: 'COMPONENT'; key: string; description: string;
  componentPropertyDefinitions: Record<string, ComponentPropertyDefinition>; variantProperties?: Record<string, string> };
export type ComponentSetNode = FrameLike & { type: 'COMPONENT_SET'; key: string; componentPropertyDefinitions: Record<string, ComponentPropertyDefinition> };
export type InstanceNode = FrameLike & { type: 'INSTANCE'; mainComponentId: NodeId;
  componentProperties: Record<string, ComponentPropertyValue>;
  overrides: Record<string /* child path "a;b" relative to the instance */, OverrideDelta>;
  scaleFactor: number };
export type SliceNode = BaseProps & LayoutProps & { type: 'SLICE'; exportSettings: ExportSetting[] };

export type SceneNode = FrameNode | GroupNode | SectionNode | RectangleNode | EllipseNode | PolygonNode | StarNode
  | LineNode | VectorNode | TextNode | BooleanNode | ComponentNode | ComponentSetNode | InstanceNode | SliceNode;
export type AnyNode = DocumentNode | PageNode | SceneNode;

// ---------- file ----------
export interface DesignFile {
  version: number; id: string; name: string;
  nodes: Record<NodeId, AnyNode>;                 // flat map, children derived from (parentId, index)
  styles: Record<string, Style>;
  variableCollections: Record<string, VariableCollection>; variables: Record<string, Variable>;
  assets: Record<string /*sha1*/, { mime: string; bytes: 'blob-ref'; width?: number; height?: number }>;
  fonts: { family: string; style: string; source: 'system' | 'embedded' | 'google'; uri?: string }[];
}
export type Style = { id: string; type: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'; name: string; description: string; key: string; value: unknown; boundVariables?: BoundVariables };

// ---------- change pipeline (undo/redo + plugin edits) ----------
export type Change =
  | { t: 'add'; node: AnyNode }
  | { t: 'del'; node: AnyNode }                                         // inverse of add, carries snapshot
  | { t: 'set'; id: NodeId; set: Record<string, unknown>; prev: Record<string, unknown> }  // property-level
  | { t: 'move'; id: NodeId; parent: NodeId; index: string; prevParent: NodeId; prevIndex: string }
  | { t: 'style' | 'variable'; /* library mutations, same shape */ };
export interface Transaction { id: string; origin: 'user' | 'plugin' | 'ai' | 'sync'; label: string;
  changes: Change[]; undo: Change[]; mergeKey?: string /* coalesce nudges/typing */ }
```

Key schema decisions: flat map + fractional index; mixin-composed discriminated union; instance overrides as per-child-path deltas; derived values (absolute transform, bounds, auto-layout positions, text layout, vector geometry) are caches, never persisted as truth; every mutation is a reversible `Change`.
