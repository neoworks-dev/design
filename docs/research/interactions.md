# Interaction Catalogue: Figma (with Penpot notes)

Provenance: **[V]** verified this session from fetched sources; **[K]** prior knowledge of Figma behavior, to be re-checked in-app (Figma's in-app panel, Ctrl+Shift+? is the canonical shortcut list).
Sources: Noble Desktop PC list https://www.nobledesktop.com/shortcuts/figma/pc (Mac: .../mac) [V]; Selection help https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects [V]; keyboard help https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard [V]; vector help https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks [V partial]; AI rename https://help.figma.com/hc/en-us/articles/24004711129879-Rename-layers-with-AI [V via search]. Mac = replace Ctrl with Cmd, Alt with Option, Delete is Backspace. Implement shortcuts as a rebindable command registry keyed by `Mod` (Ctrl/Cmd).

---

## 1. Tools and shortcuts

| Tool | Key | Behavior |
|---|---|---|
| Move | V | Select, drag, resize, rotate. Default tool. [V] |
| Scale | K | Resizes selection and scales text, strokes, effects, corner radii proportionally; children of frames are scaled irrespective of constraints/layout. [V key] |
| Frame | F | Drag a frame (or click a preset from the right panel: phone, tablet, desktop, paper...). Drawing inside a frame nests it. [V key] |
| Section | Shift+S | Draw a section (organizing container, no constraints/auto layout). [V] |
| Slice | S | Draw an export region. [V] |
| Rectangle | R | Alt = from center, Shift = square. [V] |
| Line | L | Shift snaps to 15 degree steps. [V] |
| Arrow | Shift+L | Line with arrow cap. [V] |
| Ellipse | O | Shift = circle. [V] |
| Polygon / Star | no default key (menu) | Created with shapes menu. [K] |
| Image/video | Ctrl+Shift+K | Opens file picker; click/drag to place; also paste/drag-drop. [V] |
| Pen | P | Vector network pen. [V] |
| Pencil | Shift+P | Freehand, auto-smoothed path. [V] |
| Text | T | Click = auto width; drag = fixed-size box. [V key] |
| Hand | H (or hold Space) | Pan. [V] |
| Comment | C | Click to drop pin. (Offline clone: local notes/annotations.) [V] |
| Eyedropper | I | Sample color. [V] |
| Paint bucket | B (in vector edit) | Fill regions of a vector network. [V] |
| Bend | hold Ctrl (vector edit) | Drag a segment to curve it. [V] |
| Zoom (temporary) | hold Z / Alt+Z | Zoom in/out by click-drag marquee. [V] |
| Resources | Shift+I | Components/plugins/widgets quick search. [V] |
| Actions (command palette) | Ctrl+K or Ctrl+/ | Search commands, plugins. [V] |

Tool mechanics: tool is sticky for one operation, then reverts to Move (except when "keep tool locked" via double-clicking toolbar icon in some tools [K]). Esc cancels tool. Typing a shortcut while in text editing inserts characters, so shortcuts are context-gated.

---

## 2. Full shortcut list (PC; Mac equivalents by substitution) [V from Noble Desktop PC list]

### Zoom and view
- Ctrl +/-: zoom in/out. Hold Z: zoom-in tool; Alt+Z: zoom-out tool. Ctrl+0: 100%. Shift+0: 100% [K, Mac also Shift+0]. Shift+1: zoom to fit all. Shift+2: zoom to selection. N / Shift+N: next/previous frame.
- Space+drag: pan. Arrow keys with nothing selected pan the canvas, Shift+arrow pans faster.
- Shift+R: rulers. Shift+G: layout grids. Shift+C: show/hide comments. Ctrl+Alt+\: multiplayer cursors. Shift+O: outlines. Ctrl+Shift+P: pixel preview [K]. Ctrl+' : pixel grid [K]. Ctrl+Shift+' : snap to pixel grid [K]. Ctrl+; : show/hide guides [K]. Shift+D: Dev Mode.
- Alt+drag over a numeric field: scrub value. Up/Down in fields: +/-1; with Shift +/-10.

### Panels
- Ctrl+\: show/hide UI. Ctrl+Shift+\: left sidebar. Alt+1 Layers, Alt+2 Assets, Alt+3 Libraries. Shift+E: toggle Design/Prototype. Alt+8 Design panel, Alt+9 Prototype panel.

### Selection and hierarchy
- Click: select topmost non-nested item at the current "selection level". Double-click: enter group/frame (select one nesting level deeper); repeat. Ctrl+click: deep select (picks the deepest layer under the cursor, also selects a frame when clicking blank frame area). Ctrl+drag marquee: deep marquee. [V]
- Shift+click: toggle in/out of selection. Shift+marquee: toggle marquee items. [V]
- Enter: select children (or enter text/vector editing for text/vector nodes). Shift+Enter or `\`: select parent. Tab / Shift+Tab: next/previous sibling. Esc: deselect or exit current mode. [V]
- Ctrl+A: select all in current level (siblings at the current selection scope). Ctrl+Shift+A: invert selection [V]. Ctrl+Alt+A: select matching layers [V].
- Ctrl+R: rename. Ctrl+Shift+H: hide/show. Ctrl+Shift+L: lock/unlock. 1..9,0: opacity 10%..90%,100% (0 = 100%); typing two digits quickly sets e.g. 55 [K].
- Hold Space while dragging an object: prevents nesting into / escaping from a frame. [V]
- Ctrl+Alt+M: use as mask [V].
- Ctrl+G group; Ctrl+Alt+G frame selection; Ctrl+Delete (Ctrl+Shift+G also, [K]) ungroup/unframe; Shift+A add auto layout (on a selection wraps/adds); Alt+Shift+A remove auto layout. [V]

### Arrange
- `]` / `[`: bring to front / send to back. Ctrl+`]` / `[`: forward / backward. [V]
- Align: Alt+A left, Alt+D right, Alt+W top, Alt+S bottom, Alt+H horizontal center, Alt+V vertical center. Alt+Shift+H / Alt+Shift+V: distribute horizontal/vertical spacing. Ctrl+Alt+Shift+T: tidy up. [V]
- Flip: Shift+H, Shift+V. [K]
- Ctrl+D: duplicate (duplicate offsets by the last duplicate delta: duplicating then moving, then Ctrl+D repeats the same offset [K]). Alt+drag: duplicate while dragging. [V]
- Arrow: nudge 1px; Shift+arrow: nudge 10px (big-nudge amount is configurable) [K]. Children of auto layout frames are positioned by layout, so nudging does not apply; reorder by drag or Ctrl+[ / ].

### Transform modifiers
- Resize: Shift = keep proportions; Alt = from center; Ctrl = ignore constraints (or crop image); Alt+Shift both. Rotate: Shift = 15 degree steps. Alt+Shift+drag on handle... [V for Shift 15 deg].
- Alt+double-click image: crop. Ctrl+resize with image selected crops it. [V]
- Alt+hover: show distance to selected layer; Ctrl+Alt+hover: distance within group. [V]

### Text [V]
- Enter: start editing text on selected text node. Esc: stop editing (selects the node).
- Ctrl+B/I/U; Ctrl+Shift+X strikethrough [K]; Ctrl+Shift+7 / 8: numbered / bulleted list; Ctrl+K: link (in text). Ctrl+Alt+L/T/R/J align left/center/right/justify. Ctrl+Shift+< / >: font size -/+ ; Alt+Shift+< / >: line height ; Ctrl+Alt+< / >: font weight; Alt+< / >: letter spacing. Ctrl+Alt+Shift... none.
- Ctrl+E: flatten (also outlines text).

### Vector editing [V]
- Enter / double-click: edit vector; Esc: exit. Ctrl+click on point: toggle straight/mirrored. Alt+drag handle: disconnect (break) handle mirroring. Hold Ctrl: bend tool. B: paint bucket. Shift+Delete: delete and heal. Ctrl+J: join selected points/segments (or Ctrl+J with two endpoints). Shift+X: swap fill and stroke. Alt+/: remove fill; Shift+/: remove stroke.

### Prototyping [V]
- Ctrl+Alt+Enter: present prototype. Shift+Space: preview. Arrow left/right: navigate frames in preview. R: refresh.

### Components [V]
- Ctrl+Alt+K: create component. Shift+I: insert component instance (assets search). Ctrl+Alt+B: detach instance. Alt+drag from assets over an instance: swap instance. [K: Ctrl+Alt+Shift+K create component set (combine as variants)].

### Copy/paste [V]
- Ctrl+C / X / V. Ctrl+Shift+V: paste over selection (pastes into the selected frame, at the selection's center? In Figma: "Paste over selection" places pasted objects in the *same relative position* inside the selected frame/parent) [V names]. Ctrl+Alt+C / Ctrl+Alt+V: copy / paste properties. Ctrl+Shift+C: copy as PNG. Ctrl+Shift+R: paste to replace (replaces selection with clipboard content, keeping position/size where possible) [V]. Ctrl+Shift+V on mac is "paste over selection"; plain paste of copied object keeps position if pasted on a different page/frame, else pastes at the viewport center, or into the selected frame [K]. Copy as SVG/CSS: context menu "Copy/Paste as > Copy as SVG / Copy as CSS / Copy as PNG / Copy link" [K].
- Misc: Ctrl+Shift+E export; Ctrl+F find (in file, current page layers). Select hex value + Shift+Up/Down: lighten/darken. [V]

### Other [K]
- Ctrl+Z undo, Ctrl+Shift+Z redo (Ctrl+Y on Windows). Ctrl+S in the clone = save to disk.
- Ctrl+Alt+Shift+K: combine as variants (create component set). Ctrl+Shift+G: ungroup.

---

## 3. Selection semantics (spec for the hit-test/selection engine)

Levels: the selection "scope" is the container whose direct children are selectable by single click.
1. Initial scope = page root: click selects the **top-level object** under the cursor (a top-level frame, group, or shape). Clicking inside a top-level frame on blank background selects nothing within; the frame is selected only by clicking its title label (frames show names above them), clicking its border/empty area for frames with no fill [K], or Ctrl+click. Dragging on an unfilled frame area starts a marquee when the frame is top-level; for nested frames, the frame is a normal selectable object.
2. Groups are selected as a unit on first click; double-click enters (selects the child under the cursor). Frames *nested* in the page-level frame behave like groups for click selection (click selects the nested frame, not its children) [K]. Frame children: click on a child of a top-level frame selects the child directly (Figma treats top-level frames as the "page roots", so their children are the first-level selectable items) [K, matches "select within frame rules"].
3. After entering a group, siblings in that group are directly selectable by single click; clicking outside the group resets the scope.
4. Deep select (Ctrl/Cmd+click) bypasses all levels; also ignores locked? No: locked layers are never selectable on canvas, only via Layers panel. Hidden layers are not hit-testable. [K]
5. Selecting in the Layers panel selects exactly that layer regardless of scope and sets scope to its parent.
6. Multi-select: Shift+click adds objects; all selected objects need not share a parent, but transforms operate on the combined bounding box. Dragging a multi-selection across containers re-parents each object per its center/drop target. Tab only cycles siblings of the single selected item.
7. Marquee: starts on empty canvas (or on a top-level frame's empty area when it is... no: starts only when the pointer-down hits nothing selectable at the current scope). Selects objects **intersecting** the marquee within the current scope (fully-contained requirement applies only to frames: a frame is selected only if the marquee fully contains it; otherwise its children are marquee-selected) [K]. Shift+marquee toggles.
8. Selection outline colors: blue for normal selection, hover highlight (thin blue) on the item that a click would select, purple for components/instances, red on distance measure. Selected node shows 8 resize handles + rotation zones; multi-selection shows a bounding box.
9. Esc: if in a nested scope, first Esc pops selection to parent? In Figma, Esc deselects. Shift+Enter selects parent; use that for popping.
10. Click empty canvas clears; clicking a selected object in a multi-selection (without drag) selects only that object on mouse-up.

### Hover and cursor feedback
Hover shows outline of the *would-be-selected* node plus its name label for frames. Cursor changes: resize arrows at handles, rotate cursor in the zone outside the corner handles, move cursor over distinct selected content, text I-beam over editable text.

---

## 4. Transform handles

- 8 handles (4 corners, 4 edges) on the selection bounding box, small squares (corner = white square with blue border, edge handles are invisible hit-areas along the sides [K]). Size readout pill ("W x H") is shown below the selection while dragging.
- **Resize**: drag corner = free resize; Shift = lock aspect ratio (also toggled by the proportion lock in the Design panel); Alt = scale about the center; Ctrl/Cmd (held) = ignore children's constraints (resize frame without constraints applying) / crop images; resizing with text: dragging text handles switches `textAutoResize` from WIDTH_AND_HEIGHT to HEIGHT (side handle) or NONE (corner). Flipping occurs when dragging through the opposite edge (negative size becomes flip). Minimum size 0.01.
- **Resize of groups/frames**: Frame resize applies *constraints* to children (not the Scale tool). Group resize scales children proportionally (groups have no constraints applied; children keep their own proportional scale including text size? No: text boxes get resized, glyph size unchanged; only K tool scales type) [K]. Auto layout frames with HUG/FILL ignore manual resize on hugging axes (switch to FIXED).
- **Rotate**: hover just outside a corner handle: rotate cursor, drag rotates about the selection's center (Shift = 15 degree steps). The angle readout is shown. Edge-handles do not rotate. Rotation of a multi-selection rotates each object about the common center. Rotating children of auto layout frames is allowed (layout uses unrotated size? It uses the rotated bounding box [K]).
- **Corner radius handle**: for rectangles/frames/polygons with radius support, a round handle appears inside each top-left... at the top-left (only when the object is large enough) drag to change uniform radius; Alt+drag a single corner adjusts one corner independently; shift? Number readout. Double-click... N/A. [K]
- **Ellipse arc handles**: when selected, handles for start angle, sweep, inner radius (donut). [K]
- **Auto layout handles**: padding and gap handles (pink/purple) appear when selecting an auto layout frame; drag to change padding on a side (Alt = both sides symmetric? Alt on padding handle changes opposite padding too; Shift... all sides) and the gap. [K]
- **Parent-child resizing**: The Design panel offers "Resizing" dropdown (Fixed/Hug/Fill) for auto layout children and constraints widget for non-layout children. See data-model.md sections 5 and 6.
- **Move**: drag selection; Shift constrains to axis; Alt duplicates; Space while dragging prevents re-parenting; dropping over a different frame re-parents (frame highlights in blue outline on hover while dragging). Within an auto layout frame a blue insertion indicator line shows the drop index. Ctrl while dragging an object out of auto layout? Dragging with Ctrl held places absolute? [K: Ctrl+drag inside an auto layout frame temporarily makes the item absolute-position ("ignore auto layout")].
- **Arrow nudge**: 1px / 10px with Shift [V pattern]. Nudge moves selected objects in parent coordinates; for rotated objects moves in screen axes.

---

## 5. Snapping and smart guides [K]

- **Object snapping**: when dragging/resizing, edges and centers of the moving selection snap to edges and centers of nearby objects (siblings in the same parent and the parent's bounds, plus other frames' edges at top-level) within a screen-space threshold (about 4-5 px at current zoom). Active snap lines draw in **red/pink** with small "x" markers at snapped points, spanning between the aligned objects.
- **Equal spacing guides**: when the dragged item becomes equidistant between two neighbors (or has the same gap as an existing pair), red gap brackets and distance labels appear and the item snaps to that spacing.
- **Distance measurement**: select an item, hold Alt and hover another: red lines with pixel distances to the hovered item (all four sides, drawn between bounding boxes; also to parent edges). Ctrl+Alt+hover: distances within group scope. [V keys]
- **Pixel grid snapping**: View > Snap to pixel grid (Ctrl+Shift+'): positions and sizes round to whole pixels; pixel grid draws at zoom >= 800%. Pixel preview mode renders at 1x.
- **Layout grid / column snapping**: objects snap to column/row edges of layout grids on the parent frame when visible.
- **Guides and rulers**: Shift+R toggles rulers; drag from a ruler to create a guide (a pink/red line); drag back to the ruler to delete; guides belong to the frame (if dragged from within a frame) or the page; guides snap objects. Ctrl+; toggles guide visibility. Double-click guide... N/A.
- **Disable snapping while dragging**: hold Ctrl (Cmd) while dragging temporarily disables snapping [K].
- Snap algorithm: collect candidate snap lines (x: left/center/right of each other node, y: top/middle/bottom), compute min |delta| per axis among moving-edge candidates; apply delta if < threshold/zoom; then draw guide lines for all candidates equal to the snapped position. Spatial-index query limited to nodes in the viewport.

---

## 6. Canvas navigation [V keys, K behaviors]

- Mouse wheel / trackpad two-finger scroll: pan (Shift+wheel = horizontal pan). Ctrl+wheel or trackpad pinch (ctrlKey wheel events): zoom to cursor. Cmd/Ctrl +/-: zoom around viewport center (or selection center). Zoom steps follow a preset ladder (e.g. 1, 2, 3, 4, 5, 6.25, 8, 12.5, 16.67, 25, 33, 50, 66, 100, 150, 200, 300, 400, 800, ... up to 25600%) [K].
- Space + drag, middle mouse drag, or Hand tool: pan.
- Shift+0 or Ctrl+0: zoom to 100% (Noble PC list says Ctrl+0; Figma's Mac shortcut is Shift+0) [V]. Shift+1: fit all. Shift+2: fit selection. N/Shift+N: next/prev frame. Zoom tool by holding Z and dragging a marquee.
- Arrows with empty selection pan. Mini-map: none. Zoom field in the bottom right/top bar shows percentage.
- Pointer-anchored zoom formula: `newOffset = cursor - (cursor - offset) * (newScale / oldScale)`.

---

## 7. Pen tool and vector editing

Pen tool [V partial, rest K]:
- Click = corner point; click-drag = smooth point (symmetric handles drawn as drag out); Shift constrains angles to 45; click on the first point closes the path (circle indicator on hover); Esc / Enter ends an open path; click on an end point of an existing open path continues it; click on a segment with the pen in edit mode adds a point.
- Because Figma uses vector networks: starting a new line from any existing vertex (not only endpoints) is allowed and creates branching; clicking a vertex then another existing vertex connects them; closed loops automatically become fill regions.
- Vector edit mode (Enter or double-click): select vertices/segments (click, shift-click, marquee); drag moves; arrow nudge; Delete removes selected vertex and its segments (Shift+Delete heals: deletes the vertex and reconnects neighbors [V]); Ctrl+J joins; Right-click: Flatten/Join/Delete...
- Bend tool (hold Ctrl): drag on a vertex converts between corner/curved (drag from a vertex creates handles; click a vertex with handles removes them); drag a segment to bend it directly (computes tangent handles from the drag) [V/K].
- **Handle mirroring modes** (Design panel in vector edit mode: "Mirroring"): None (handles independent), Angle (collinear handles, independent lengths), Angle and length (symmetric). Ctrl+click on a point toggles straight/mirrored. Alt+drag a handle breaks mirroring for that handle for the drag (disconnect). [V]
- Point corner radius: in vector edit, select a point, a corner-radius field in the panel rounds it.
- Pencil (Shift+P): freehand; on release, the stroke is simplified into a smooth path (curve fitting, e.g. Schneider algorithm); Figma auto-smooths with a "smooth" setting.
- Paint bucket (B) fills a region of the network (creates/changes `regions` fills).
- Flatten (Ctrl+E): converts shapes/boolean/text (outlines) to a single VECTOR. Outline stroke converts strokes to fills.

---

## 8. Text editing interactions [V keys, K behaviors]

- Click with text tool on empty canvas = auto-width text box; click-drag = fixed width, auto height. Click on existing text = enter edit with caret; double-click on text with Move tool = enter edit mode and select the word [K]; Enter on selected text = edit mode with all selected; Esc exits.
- Caret movement: arrows, Ctrl+arrows by word, Home/End, Ctrl+A select all. Triple-click selects paragraph. Shift+arrows extend. Standard IME composition support is required.
- Formatting applies to the selection range (or to the whole node when the node is selected, not in edit mode). Mixed ranges show "Mixed" in panel fields.
- Resizing the box by handle: side handles set fixed width/auto height; Auto-resize buttons in the Typography panel: auto width, auto height, fixed.
- Lists (numbered/bulleted via Ctrl+Shift+7/8, Tab/Shift+Tab to indent level inside list [K]). Links via Ctrl+K. OpenType features and variable axes in the "Type settings" popover.
- Text selection on canvas shows highlight; clicking outside commits (one undo entry per edit session, typing coalesced by pause).
- Missing fonts: show warning and fallback; edit prompts font substitution.

---

## 9. Layers panel (left sidebar) [K unless noted]

- Tree shows the page's nodes top-most first (reverse of children array order). Rows: expand chevron, type icon (frame #, group, component diamond, instance hollow diamond, text T, vector pen, image), name, hover actions (lock, visibility eye), indentation per depth.
- Click selects; Shift+click range-selects; Ctrl+click toggles; selecting on canvas auto-expands and scrolls to the layer; Alt+click chevron expands/collapses all descendants [K].
- Drag to reorder: drop between rows reorders; a blue line shows the insertion point and indent level determines the parent; dropping onto a container row's center nests the item. Dragging across pages is supported via the Pages list [K].
- Double-click name or Ctrl+R: rename inline; Enter commits, Esc cancels. Tab moves to next layer rename [K].
- Visibility toggle (Ctrl+Shift+H) and lock (Ctrl+Shift+L). Alt+click eye = solo toggle? [K: Alt+click toggles all siblings].
- Hidden layers show dimmed; locked layers show a lock icon and are not hit-tested on canvas but selectable in the panel.
- Components are listed in purple. Instances show main-component icon. Layer search/filter (Ctrl+F in Layers filters by name/type/color etc., with filter by type chips) [K].
- Pages section above the layer tree: list with add/reorder/rename/duplicate/delete, "Page 1" etc.; new page named "Page N".
- Auto-naming: new layers get type-based names (Rectangle 1, Frame 2, Group 3, Ellipse 4...), text layers auto-name from content until renamed (`autoRename`) [V autoRename property].
- Multi-select drag moves all; Ctrl+C in layers copies; right-click context menu same as canvas.

---

## 10. Right sidebar: Design / Prototype / Inspect(Dev Mode) [K; Shift+E toggles Design/Prototype, Alt+8/9 [V]]

### Design tab (order for a frame; sections show only when applicable)
1. Top bar: Share, zoom %, multiplayer avatars (clone: zoom %).
2. **Alignment** row (6 align buttons + distribute + tidy up) - when multiple items or inside frame.
3. **Frame/Position**: component/instance controls at top for components; for frames: preset dropdown; **Position** (X, Y, rotation, "constraints" widget for non-layout children); **Layout** (width W, height H, proportion lock, Clip content, resizing dropdowns Fixed/Hug/Fill, min/max); **Auto layout** (direction buttons, gap, padding H/V or per side, alignment 3x3 grid, wrap, absolute position toggle, strokes include, canvas stacking); **Layout grid** (+ add).
4. **Appearance**: opacity, blend mode (Pass through/Normal...), corner radius (uniform + per-corner toggle), corner smoothing, visibility eye, Mask toggle.
5. **Typography** (text only; placed after Layout/Appearance in new UI, before Fill): font family, weight, size, line height, letter spacing, align H/V, decoration, case, list, auto-resize, Type settings (OpenType, truncation, paragraph spacing/indent, leading trim).
6. **Fill**: list of paints (+ add), each: visibility eye, type picker (Solid / gradients / Image / Video), hex + opacity inputs, style (4-dots) and variable binding buttons.
7. **Stroke**: paints, weight, position (inside/center/outside), advanced: cap, join, dash/gap, miter, per-side weights.
8. **Effects**: list (drop shadow, inner shadow, layer blur, background blur): each with settings popover.
9. **Selection colors** (shows all colors used in selection; edit/replace en masse).
10. **Export**: settings list (scale, suffix, format) + export button, preview.
Component/instance additions: properties section at top (instance: property controls for variant/boolean/text/swap; main: property definitions list), variant tables in sets.

### Prototype tab
Interactions list per selected node: "+" add interaction -> trigger dropdown, action dropdown, destination, navigation type, animation (type, easing, duration); Flows starting points; Device preset; Background color; Frame props: Overflow scrolling, "Clip content"; Overlay options; Fixed-scroll option; Variables conditionals.

### Inspect / Dev Mode (Shift+D)
Read-only specs: dimensions, CSS/iOS/Android code, measurements on hover (Alt not required), asset export, status ("Ready for dev"), layer-code via codegen plugins. For the clone: an "Inspect" tab showing CSS/SVG/JSON for the selection.

---

## 11. Context menu contents (right click on canvas) [K]

Top to bottom: Copy / Cut / Paste here (at cursor) / Paste over selection / Copy/Paste as > (Copy as CSS, Copy as SVG, Copy as PNG, Copy properties, Paste properties) / Copy link / Duplicate (Ctrl+D) / Delete / Group selection / Ungroup / Frame selection / Add auto layout / Remove auto layout / Create component / Detach instance / Swap instance (for instance: Reset all overrides, Go to main component, Restore main component, Push overrides to main component) / Use as mask / Flatten / Outline stroke / Boolean groups > (Union, Subtract, Intersect, Exclude, Flatten) / Select layer > (stack of layers under the cursor) / Bring to front / Bring forward / Send backward / Send to back / Flip horizontal / Flip vertical / Show/Hide selection / Lock/Unlock / Set as thumbnail / Plugins > / Add to selection / Export / Rename / Hide others? Context menu varies by node type.
Canvas empty right-click: Paste here, Show/Hide UI, Show rulers, Zoom options, Plugins.
Layers panel context: same plus Rename, Collapse/Expand.

---

## 12. Copy, paste, duplicate semantics [V names, K details]

- **Copy (Ctrl+C)**: serializes selected subtree(s) with relative positions to the clipboard in a custom format (Figma writes HTML with a `<span data-metadata>` base64 payload plus a PNG/SVG representation) so it can paste into other files. Offline clone: store JSON of subtree with `application/x-figma-clone` MIME + also write PNG or SVG fallbacks.
- **Paste (Ctrl+V)**: pastes into the currently selected *frame* (at same relative coordinates if it fits, else centered) or, if nothing selected, onto the page at the **viewport center** (when original is not visible in viewport) or the same position as the original if it is within the viewport? Figma rule: pasted objects keep the original coordinates when pasted into a different page or parent; otherwise paste at center of viewport. When a non-container is selected, pastes into its parent above it in z-order. Names get unchanged; IDs regenerate; component instances remain linked (to the same file's main component, or to the library). Pasting a main component creates a new main component copy. [K]
- **Paste over selection (Ctrl+Shift+V)**: pastes into the selection's parent at the same relative position [V name]. **Paste to replace (Ctrl+Shift+R)**: replaces selected layers with clipboard content (position/size preserved for single swap, frame children placed accordingly) [V name].
- **Paste here**: context menu, places the center at the cursor.
- **Copy/paste properties (Ctrl+Alt+C / V)**: copies appearance properties (fills, strokes, effects, opacity, radius, text style) between layers. [V]
- **Copy as PNG (Ctrl+Shift+C)**, Copy as SVG, Copy as CSS (context menu).
- **Duplicate**: Ctrl+D duplicates in place offset +0 (first) then repeats last offset; Alt-drag duplicates and drops at the cursor delta; Alt+Shift drag constrains axis. Duplicated auto-layout children land after the original in the layout. Components duplicated as new components (copy of main) unless dragging an instance.
- **Paste image from clipboard/file drop**: creates a rectangle with image fill (scaleMode FILL) at natural size, max size to viewport; drop onto a shape replaces/ creates fill if modifier [K]. SVG paste creates vector layers/frames. Text pasted as plain text creates a text node.

---

## 13. Align, distribute, tidy up, boolean, flatten, mask, grouping [K unless marked]

- **Align** (single selection aligns to parent frame; multi-selection aligns to the selection bounds). Six align commands [V keys]. Nudging via Alt+arrows? none.
- **Distribute spacing**: Alt+Shift+H/V; equal gaps between >= 3 objects (and "Distribute horizontal spacing" w/ gaps field via Tidy up). [V]
- **Tidy up** (Ctrl+Alt+Shift+T) [V key]: for selected objects arranged roughly in rows/columns, snaps them into a uniform grid with consistent gaps (or converts to auto layout when the selection has loose structure: it moves objects into a tidy grid). Algorithm: cluster rows by vertical overlap, sort by x, set gap = average or most common gap.
- **Boolean ops**: Union, Subtract, Intersect, Exclude via the toolbar or right-click > Boolean groups. Result is a BOOLEAN_OPERATION node with children as operands; operation order by z (bottom is the base for subtract). Alt+click the toolbar button = flatten immediately. Flatten (Ctrl+E) converts to a vector. Uses path clipping (Clipper or Paper.js boolean) on cubic outlines.
- **Mask** (Ctrl+Alt+M) [V]: topmost selected shape becomes the mask; selection is grouped (or framed); mask shape drawn with fill ignored. Mask types: alpha / vector / luminance via Mask icon.
- **Group** (Ctrl+G) [V]: wraps selection in a GROUP placed at the topmost selected node's z-index in its common parent (if selected nodes have different parents, uses topmost-parent... the common ancestor). **Frame selection** (Ctrl+Alt+G) wraps in a frame sized to bounds. **Ungroup** (Ctrl+Shift+G, [K]; also Ctrl+Delete [V]) lifts children preserving absolute transforms and z-order. Group name default "Group N". Selecting a single frame and pressing Ctrl+G wraps that frame in a group.
- **Add auto layout** (Shift+A) [V]: on a frame, turns it on inferring direction from children arrangement (rows vs columns), gap from median spacing, padding from child-to-edge gaps; on non-frame selection, wraps in an auto layout frame.
- **Outline stroke**, **Flatten** produce VECTOR nodes.
- **Z-order**: `]`, `[` and Ctrl variants [V].

---

## 14. Undo/redo granularity [K, aligns with plugin API `commitUndo`]

- Ctrl+Z undoes the latest *user action*: one drag/resize/rotate gesture (pointer down to up) = one step; a nudge key tap = one step, but rapid repeated nudges coalesce (mergeKey 'nudge' within ~1s)? Figma records each key press separately in practice, hold-repeat coalesces. Typing in a field commits on blur/Enter. Text editing: one step per edit session segment (coalesced by pauses ~500ms+, and by operation type). Creating a shape = one step; drawing with pen = one step per placed point? Pen: whole path build is undo-able per point in-progress, then single step at commit [K]. Multi-property operations (Add auto layout, paste, boolean op, plugin runs) = one step. Plugin runs: Figma groups one plugin invocation's changes into one undo step unless it calls `figma.commitUndo()` [V API exists].
- Selection and viewport changes are NOT in the undo stack (Figma does keep selection restoration: undo restores the selection as it was) [K].
- Undo is per-user in multiplayer; offline clone: single stack per document session, persisted across saves optional.
- Redo stack cleared by any new action. Penpot: transactions with `undo-group`; stack capped at 50 [K].

---

## 15. Penpot interaction differences worth noting [K, https://help.penpot.app/user-guide/]
- Board tool = B (frame), Rectangle R, Ellipse E, Text T, Path P, Curve (pencil) Shift+C, Image K (Shift+K), Comments C, Move V, Plugins Alt+Ctrl+P, Zoom: Shift+0 reset, Shift+1 fit, Shift+2 selected; Flex layout toggle Shift+A (add) / Ctrl+Shift+A (remove?) [K], Grid layout Ctrl+Shift+A. Clone should support Figma preset by default and an optional Penpot keymap.
- Penpot has no Tab-sibling traversal parity; Enter selects children also; Shift+Enter selects parent.
- Penpot has "Dynamic alignment" snapping with pink guide lines similar to Figma's red.

---

## 16. Figma AI features (inspiration for AI integration) [V from search results, K otherwise]
Sources: https://help.figma.com/hc/en-us/articles/24004711129879-Rename-layers-with-AI, https://blog.logrocket.com/ux-design/figma-ai-2026-quick-overview/, https://www.builder.io/blog/ai-figma.
- **First Draft / Make Designs**: prompt + template (Basic App, App Wireframe, Basic Site, Site Wireframe) -> generates real Auto Layout frames with editable layers using components from a design system; limited iteration after manual edits. [V]
- **Figma Make**: prompt-to-code (React) prototypes/apps from prompts or from selected frames; chat iteration; code view. [K]
- **Rename layers**: right-click, Actions, or quick-actions; names only layers with default names; considers content, position, siblings; skips hidden/locked layers, layers in instances, vectors. [V]
- **Search with image/selection**: find components/assets by selecting an element or uploading an image; semantic search over the file/library. [V]
- Others [K]: AI image tools (remove background, generative fill / replace, expand, upscale), "Make an image," AI prototype wiring ("Make prototype"), AI text rewrite/shorten/translate, Generate copy, Vector/Illustration "Magic", alt-text, "Make changes" in Make, Dev Mode MCP server (design context to coding agents), Code Connect.
- **AI integration patterns for our clone**:
  1. A command-palette (Ctrl+K) with natural language -> structured tool calls (create node, set props, apply auto layout, rename, align).
  2. All AI edits executed through the same Change pipeline (origin 'ai'), one undo step per request, previewable (ghost) before accept.
  3. Selection-scoped context: serialize selected subtree to compact JSON (types, names, layout, styles, text) as model context, plus a screenshot export.
  4. Batch operations: rename layers, generate alt text, color/spacing audits, convert to auto layout, content fill (placeholder text/images), variable binding suggestions.
  5. The same function surface should be exposed as plugin API + MCP tools so plugins and agents share capabilities.
