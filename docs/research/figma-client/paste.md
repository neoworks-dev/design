# Paste and duplicate placement: Figma client evidence

Sources: pass 2 dump (see `README.md`, "Pass 2"). Read-only analysis of `219-compiled_wasm.wasm`
(`core.wat`, 51073 funcs, no function names) plus the JS bundles. Nothing was executed.

Tags: `[code]` read in the wasm and reproduced by hand, `[inferred]` follows from code but a name or
meaning was guessed, `[docs]` Figma help center only, `[guess]` no direct evidence.

Status: see "Measured" below; it supersedes the decision list where they differ. The analysis was stopped before every branch of the paste path was decoded. The pieces below
are solid; the glue between them has gaps, listed in "Where this got stuck". Experiments to close the
gaps are at the end.

## 0. Summary (decision list)

All numbers are canvas units unless noted. `V` is the viewport rectangle in canvas space (so it
shrinks as you zoom in and moves as you pan). `N` is the bounding box of the pasted content at its
original position. Every resulting offset is rounded to an integer (round half away from zero).

Plain paste (Ctrl+V), Design file. Order is the order of the code, roughly:

1. Compute `N` (union of the absolute bounds of the clipboard roots) and `V`. [code]
2. "Next to the original": if exactly one node is selected, exactly one root is on the clipboard, and
   the selected node is a plain frame that is either the copied node or the same size (within 0.01 px
   on w and h) as the copied one with the same parent as the paste destination, then the copy is
   moved to the right until it no longer overlaps any sibling: `x = right edge of the hit + 40`,
   repeated, `y` unchanged. [code for the loop and the 40; inferred for the exact trigger]
3. Otherwise, if the destination (page or container) has no children: move the content so its top
   left is at the destination origin (0,0 in the destination's coordinates). [code]
4. Otherwise, if the original is not visible (different file, different page, or `N` does not
   intersect `V`): move the content so its centre is the centre of `V`. [code]
5. Otherwise: keep the position (offset 0 at page level). So with nothing selected and the original
   on screen, a copy lands exactly on top of the original. [code, with the branch conditions inferred]
6. If the destination is a container (frame) and the shifted content does not intersect it: apply
   the keep/centre rule of section 3 (per axis: keep, else centre). [code]
7. Last guard: if `N + offset` does not intersect `V` scaled by 2.0 about its centre (that is 50 % of
   the view size added on every side), replace the offset by "centre `N` on the centre of `V`".
   Skipped in the table/multi-target modes. [code]
8. After insertion, adjust the view (pan just enough, maybe zoom) per section 5. [code]

Paste here (mode 2, needs the viewport object): offset = round(cursor - top left of `N`). [code]

Duplicate (Ctrl+D, `duplicate-in-place`), Design file, identity transform, exactly one node selected:
if the node is a top-level layer (parent is the page; also nodes in a responsive set or webpage) of an
eligible type, the copy goes to the right of the original with the same loop and the same 40 px gap.
If the original is outside `V` the copy is first centred on `V` and then pushed right past anything it
overlaps. Otherwise (several nodes selected, node inside a frame, rotated, alt-drag with a transform)
the copy is placed by the transform, which is the identity for keyboard duplicate in Design. [code]

The "gap" 40 is one constant (see 2.2). The viewport enters through `V` in steps 2 (indirectly via
"original visible"), 4, 7 and 8, which is why the landing spot depends on zoom and pan.

## Measured (live Figma, 2026-10-09)

Where the sections above and this one disagree, this one is right. Measured with the interaction lab
(`bun run interactions run <name> --target figma`), Chromium on a virtual display, canvas 908 x 812,
one lab page, real Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D and the context menu entry "Paste here". Each
experiment is a committed baseline in `scripts/interaction-lab/baselines/figma/<name>.json`; our app
is held to the same numbers by `bun run interactions check`. Implementation: `src/lib/editing/paste.ts`
(`planPaste`), `duplicate.ts`, `placement.ts`, `pasteView.ts`.

### Ctrl+V of one top-level frame (paste-next-to, paste-offscreen, paste-other-page)

- **Contradicts 0 / 2.2 (nothing selected):** after Escape the copy still goes next to the original:
  A at 0,0 (400 x 300) pastes to 440,0 with and without A selected. Next to the original does not need a
  selection. Pasting again with the copy selected gives 880, then 1320 (right edge + 40 each time).
- Rectangles, text, groups, components (they paste as instances), a rectangle in a frame and a frame in
  a frame are never pushed: they land in place (paste-node-types). Only frames are.
- Nothing selected and the original is not on screen: no push, the copy is centred on the view centre.
  The cut-off is the view itself: the original is on screen when its box strictly intersects the view
  (view starting 0.01 view widths left of the original's right edge: pushed; 0.01 beyond: centred),
  the same in view widths at zoom 1 and 0.25 (so the same in canvas units only after scaling by the
  view size), above and below too. Whether the original is selected makes no difference.
- **The 2x guard (2.4) was never seen:** pushed copies that end 0.3 to 0.8 view widths beyond the right
  edge (zoom 4 and 8) stay where the push put them.
- A selected frame of the same size (400 x 300, anywhere on the page) starts the push at itself:
  copy of A with "Same size" at 1000,500 selected lands at 1440,500 in the page. A selected frame of
  another size takes the paste inside it (below). Two frames copied: in place, whatever is selected.
  An unrelated rectangle selected: in place, on the page.
- The push is collision based: with a 200 wide frame already at 440 the copy goes to 680. It also
  starts when the original is on another page, as long as the original's box touches the view and a
  same-size frame is selected there (paste-other-page, S2 at the same place: 240).
- Rotated frames are pushed by their bounding box: a frame rotated by 10 degrees, bounding box 0,-34.73
  223.01 x 182.45, duplicates to 263,-35 (x = right edge + 40, then the box is rounded to whole pixels,
  so the offset is 263,-0.27).

### Ctrl+V into a selected frame or with a frame as the original parent (paste-destination)

- A selected frame that is the copied node (or one of the copied roots) takes the copy beside it, not
  inside it. Any other selected frame takes it inside, on top.
- Inside: the position is kept when the content touches the frame, else each axis that misses it is
  centred, both when the content is larger than the frame (the rule of section 3, checked on all eight
  cases of experiment 15). The reference area is the frame cut to the view: a frame half out of view
  with a rectangle that misses it is centred in the visible half; one that touches the frame is kept
  and the view pans to it.
- "Kept" means the page coordinates for content copied from the page, and the offset inside the old
  parent for content copied from a frame (copy of R at 50,50 in G, paste into F at 1000,1000: 1050,1050;
  copy of R at 100,100 on the page: centred in F, not 1100,1100).
- A selected frame that is completely out of view is not the destination: the content goes to the page
  and is centred on the view.
- With nothing selected, content copied from inside a frame that is on screen goes back into that frame
  (same position); if the frame is off screen it goes to the page.
- There is no "empty destination moves to the origin" rule for rectangles: an emptied page gets the
  rectangle back at its old position when that is on screen and at the view centre when it is not, and an
  empty frame is treated like a full one (experiment 14 expected the frame origin: it is centred when
  the content misses the frame, kept when it touches it).
- **A top-level frame pasted on an empty page goes to 0,0**, whatever its old position or the view
  (frame cut at 300,200, view on it or far away: 0,0). Same on an empty second page.
- Another page of the same file (paste-other-page): rectangle centred on the view centre; frame centred
  too on a page that has content; origin on an empty page. Our app follows this; another file was not
  measured (needs two files) and is assumed to behave like another page.

### Paste here (paste-here)

Top-left on the cursor, with no clamping near the edges (cursor 0.97 view widths right: top-left 0,0
from the cursor), for every size. Context menu entry "Paste here" needs the clipboard permission
(`Browser.grantPermissions`), otherwise Figma waits on a prompt. **Not like the earlier app:** it centred
the content on the cursor. A drop of files still centres on the drop point (our `drop` mode).

### Duplicate, Ctrl+D (duplicate)

- A top-level frame goes 40 right of the original (and of whatever the copy overlaps, `x = right edge +
  40`, repeated); the copy stays selected, so the next Ctrl+D steps by width + 40 again (240, 480, 720,
  960, 1200 for 200 wide frames); re-selecting the original and duplicating again lands behind the first
  copy (480). A 300 wide frame at 240 moves the copy to 580. Rotated frames: by bounding box (above).
- **Contradicts 0 / 6 (types):** rectangles, text, components, groups, two frames selected, a
  rectangle in a frame and a frame in a frame are duplicated in place. Only top-level frames are pushed.
- Original out of view: any node, also nested ones and groups, is centred on the view centre (a nested
  node is centred even outside its parent); a top-level frame is then pushed past what it overlaps.
  View starting 0.01 view widths past the frame: centred; overlapping it: pushed.

### View after the action (paste-view, duplicate, paste-destination, paste-here)

- The safe area is the view inset by 1/16 on every side (so 87.5 % of it): confirmed to the pixel (the
  content ends up at 0.0625 or 0.9375 of the view).
- Paste (pan mode "overlap"): per axis, nothing moves when the content overlaps the safe area, else the
  nearest content edge goes to the safe edge. Content straddling the left, right, top or bottom edge,
  or in the margin ring, pans; a 400 x 40 box hanging 100 out of the right edge does not.
- Duplicates that moved the copy (pushed or centred) pan just enough: the whole copy ends inside the
  safe area (copy at 480..680, safe area ends 597: the view pans by 83). Plain duplicates in place keep
  the paste behaviour.
- Zoom: normal paste and duplicate zoom to the content only when it covers the whole safe area
  (0.9 x 0.9 views: zoom, 0.8 x 0.8: none; strips of 3 x 0.2, 2 x 0.5 and 0.2 x 3 views: none). Paste
  into an empty page always zooms to fit. Paste here zooms when the content is larger than the safe
  area in width or height (0.9 x 0.3 view: zoom). An empty frame does not zoom.
- Zoom to fit puts 40 px around the content and 60 px more below it (toolbar): margins 40 left and
  right, 45 above and 105 below for a 100 x 80 rectangle (width limited, `(W - 80) / w`), 40 above and
  100 below when the height limits (`(H - 140) / h`). No zoom cap seen below 8.28.

## 1. Where things are (function indices, strings)

Function numbers are wasm function indices in `core.wat` (`getfunc.sh core.wat <idx>`). Line numbers
are the `(func (;idx;)` line in `core.wat`.

| Function | wat line | What |
| --- | --- | --- |
| 46030 | 18600826 | Export `dia` = `FullscreenUi.handlePaste` (JS `FullscreenUi.handlePaste()`, no arguments; JS does not place anything) |
| 30504 | 13992641 | handlePaste: profiling scope string `handlePaste` at 1112160, analytics `paste`, `top_level_mode`, `edit_mode`; calls 6903 |
| 6903 | 2037228 | Virtual dispatch to the edit mode (`call_indirect`), so the real paste code is in the edit-mode class |
| 29746 | 13587479 | `FGLayoutEditModeCopyPaste.cpp` (`__FILE__` at 977527); asserts "ignoring paste without active document / clipboard / racy page change"; calls 24546 |
| 24546 | 10496093 | Paste driver: calls 28097 (locations), 6438 (Paster), 7674 (view adjust). Signature roughly `(out, clipboardCanvas, destination, app, viewport, pasteOption)` |
| 28097 | 12634215 | `getInsertionLocationsToPaste` (string 1112086): computes `N` as union of root bounds, reads `V` through viewport vtable slot 28, calls 28094 |
| 28094 | 12613847 | `FGCopyPaste.cpp` (`__FILE__` at 977592), 19916 lines. The offset computation. Parameters, in order: out, app, viewport, destination ref, clipboard ref, `N`, `V`, pasteOption, out vector |
| 6438 | 1691684 | `FGPaster.cpp` core: dependency cloning, state groups, variables, "insert-clones-to-target-scene". Does no placement arithmetic. Strings `paste executing on Paster`, `beginPaste`, `endPaste`, `pasteMode` |
| 7674 | 2302487 | `ensureSelectionContentsAreVisibleInViewport` (string 1389265): post-paste view adjustment |
| 12113 | 4426712 | Duplicate action (`transformByForDuplicateAction`, string 1009038). Takes a transform; for Ctrl+D it is the identity |
| 6328 | 1641802 | "Move rect to a free spot": the loop that moves a rect right (or left) past colliding siblings |
| 7671 | 2301750 | Finds the topmost child of a parent whose bounds intersect a rect (used by 6328) |
| 11879 | 4234617 | Keep or centre inside a container (section 3) |
| 28095 | 12633763 | Centre `N` in a rect: `round(centre(C) - centre(N))` |
| 28096 | 12633804 | "Single clipboard root vs single selected node" test used for the next-to rule |
| 38977, 38976, 23185, 38975 | 16559837, 16559653, 9930854, 16559396 | The four lambdas (vtables at 1748760, 1748772, 1748784, 1748796) passed to 28096 |
| 2217, 9295, 2491 | 91871, 3041595, 189601 | Rect intersects (strict), "A at least as big as B", "A contains B" |
| 3514, 6422, 1858, 1914, 2677 | 584128, 1689928, 14000, 26426, 230456 | Rect intersection, scale about centre, centre point, round, translate |
| 2462, 41949 | n/a | Viewport canvas-space rect: `x = -offset.x/scale`, `w = size.w/scale` (so V depends on zoom) |
| 7770, 3278, 18685, 3987 | 2348513, 512515, 7646545, 829033 | Type filters (top-level eligibility, plain frame) |
| 12555, 4713 | 4732390, 1080768 | FigJam-style duplicate offset (16), component-set spacing (16 or 10) |
| 10233, 46247, 46248, 46021 | 3378168, 18719818, n/a, 18593134 | Template insertion with a 128 gap (not paste, section 7) |

Strings used as anchors (address in linear memory, from `memstr.py`): `FGPaster.cpp` 968667,
`FGCopyPaste.cpp` 977592, `FGLayoutEditModeCopyPaste.cpp` 977527, `getInsertionLocationsToPaste`
1112086, `beginPaste` 1112115, `endPaste` 1112172, `handlePaste` 1112160, `pasteAbsolutePosition`
998946, `paste_at_mouse` 1121732, `paste_over_selection` 1004188, `paste_to_replace` 1209695,
`paste_and_match_style` 1151593, `paste_animation` 1012383, `inPasteToReplace` 1209862,
`ensureSelectionContentsAreVisibleInViewport` 775556, `centerSelectionToViewport` 775530,
`noPanViewportMultiplier` 941865, `panJustEnoughViewportMultiplier` 941889.

The paste option enum (analytics names in function 29747): 0 `default`, 1 `paste_over_selection`,
2 `paste_at_mouse`, 3 `paste_and_match_style`, 6 `paste_to_replace`, 9 `paste_animation`. [code]

`pasteOffset`, `pasteID`, `pasteFileKey`, `pasteIsPartiallyOutsideEnclosingFrame`, `pastePageId`,
`isCut` are fields of the Kiwi clipboard `Message` (schema embedded in chunk 86, line 537142 of
`86.pretty.js`): `Vector pasteOffset=13`, `bool pasteIsPartiallyOutsideEnclosingFrame=19`,
`GUID pastePageId=20`, `bool isCut=21`; `ClipboardSelectionRegion` has `parent`, `nodes`,
`Vector enclosingFrameOffset`, `bool pasteIsPartiallyOutsideEnclosingFrame`. The strings occur only in
the schema blob and the JS schema, with no code reference; nothing in JS reads them. [code]

## 2. Rule details

Geometry conventions [code]: a rect is four f64 `x, y, w, h` at offsets 0, 8, 16, 24. `+inf` is used
as the sentinel for "unbounded", so right = `(x == inf) ? inf : x + w`. Intersects (2217) is strict
on all four sides (touching rects do not collide) and requires `w, h >= 0`. Node bounds used for
placement are the cached absolute bounds at node offset +308 (read with 1837).

### 2.1 The viewport and the "original visible" flags

- `V` comes from viewport vtable slot 28 (functions 28097 line ~156, 7674, 12113 line ~5393).
  Function 2462 builds it as `x = (-offset.x)/scale`, `y = (-offset.y)/scale`, `w = size.w/scale`,
  `h = size.h/scale`. [code]
- In 28094: `sameFile` (analytics key `sameFile`), `samePage` (clipboard `pastePageId` equals the
  current page GUID, only evaluated when `sameFile`), and
  `originalVisible = sameFile && samePage && intersects(N, V)`. [code for the structure; the
  mapping of the two compared fields to file key and page id is inferred]

### 2.2 Next to the original, gap 40 (functions 6328, 7671, 28096, 28094)

Function 6328 (`out, ctx, rect, offset, parentRef, directionRight`) [code]:

```
out = rect
if offset != (0,0): out += (dir ? offset : -offset)
else:
    parent = parent of node(parentRef), else the page from ctx
    while (hit = 7671(parent, out)):          // topmost visible sibling intersecting out
        out.x = dir ? right(hit) + G : (hit.x - out.w) - G
out = round(out)                              // x and y
```

`G` is `i32[4556048]`. That address is the first field of a data blob
(`(data (;11624;) (i32.const 4556048) "(\00\00\00\01\01\00\00\ff\ff\ff\ff...")`) whose first i32 is
**40**. The address is only ever read (functions 6328, 12113 twice, 8670, 43020, 43022, 43023,
51093), never stored, so the gap is the constant 40. The y coordinate is never touched. [code]

`7671` iterates the children of the parent from the last to the first and returns the first child
that passes `f2025` (a visibility flag test, not hidden, not an excluded state) and `f2730`, and whose
cached bounds intersect the rect. [code; the meaning of the two predicates is inferred]

Paste call site: 28094 +14185 (`f6328(out, ctx, rect, zeros, firstInsertionLocation, 1)`, direction 1 =
right). The start rect is `N`, or `N`'s size placed at the container's top left when exactly one
insertion location exists and its bounds intersect `V`. The result is stored as
`offset = round(out - N.origin)`. [code]

The trigger is `((nextToA && !flagF) || nextToB) && !(destinationEmpty || (!containerVisible && !sameFile))`
(names are mine; 28094 +14001 and +14011):

- `28096(clipboardRoots, V, selection, originalVisible, sameFile, fnA, fnB)` [code]:
  - needs exactly one selected node `S` (selection vector size 8 bytes) and `fnA(S)`;
  - if `originalVisible` and the clipboard is empty it returns true;
  - needs exactly one clipboard root `C`;
  - `viaSameNode = sameFile && f28759(C, S)` where 28759 compares the two GUIDs (so: the selected
    node is the node that was copied);
  - `sameSize = (C.w - S.w)^2 + (C.h - S.h)^2 <= 0.0001` and `fnB(C)`;
  - returns `(originalVisible || intersects(rect(C), V)) && (viaSameNode || sameSize)`.
- Lambdas for the frame variant (vtable 1748760 / 1748772) [code]:
  `fnA(S)` = S is a FRAME that is not flagged by `f2128`, or S's parent is a RESPONSIVE_SET (39) or
  WEBPAGE (55), or a feature-flagged CODE_INSTANCE (42) case (functions 38977, 18685, 3987);
  `fnB(C)` = `fnA(C)` and `parent(C) == destination id` (function 38976).
- Lambdas for the second variant (vtables 1748784 / 1748796): `fnA(S)` = S is a SLICE (14) (function
  23185), `fnB(C)` = C is a SLICE with a parent test (function 38975). [code]
- The frame variant is only run when bit 7 of the 16-bit clipboard flags at struct offset +100 is
  clear; the same bit gates `nextToB` (`flagF`). Bit 9 of the same field is `isCut` (analytics key
  `isCut`). [code] That bit 7 is `pasteIsPartiallyOutsideEnclosingFrame` is [inferred] (the Kiwi
  field order matches, no code names it).
- `destinationEmpty` = the destination node has no children and no insertion location was resolved.
  `containerVisible` = the single insertion location's bounds intersect `V`. [code, names inferred]

Consequence [inferred from the above]: after Ctrl+C the frame stays selected, so Ctrl+V with that
frame still selected satisfies "selected node is the copied node" and the copy is pushed to the right
of the original (and of anything else it would overlap). With nothing selected (selection size not 1)
28096 returns 0 and the copy is not pushed. The type filter `fnA` means the push is for frames (and
slices), not for rectangles, groups, components or instances; that part still needs the experiments.

### 2.3 Destination empty, original not visible, keep (28094 +14217 .. +14292)

```
if destinationEmpty:      offset = (round(-N.x), round(-N.y))           // N top left to (0,0)
else if !originalVisible: offset = round(centre(V) - centre(N))         // unless a stack mode flag is set
else:                     keep the offset computed so far               // (0,0) at page level
```
[code] The "so far" offset is `vcall<3>` slot 208 on the object at `app+900` applied to the
destination id (28094 +13900): the absolute origin of the destination, i.e. a coordinate-space
conversion, zero for the page. [inferred]

Note the centring uses `V` itself here, not the 2x rectangle.

### 2.4 The 2x guard (28094 +16570 .. +16642)

```
if (!(explicitLocations || tableMode)):          // l100 = l40 | l54
    V2 = scale(V, 2.0) about its centre          // function 6422 with factor 2
    if (!intersects(V2, N + offset)):
        offset = round(centre(V) - centre(N))    // scale for the paste set to (1,1)
```
[code] This is the "area larger than the view" from the help center: factor 2.0 on w and h about the
centre means 50 % of the view size on every side. The tested rect is `N + offset`, the bounds of the
pasted content, not a point. For the explicit-location modes the guard is the plain
`intersects(V, N + offset)` (28094 +16839). [code]

### 2.5 Paste here (28094 +11847)

`if (pasteOption == 2 && viewport != null)`: `cursor = viewport.vcall<3>[+12](viewport,
viewport.vcall<2>[+84](viewport))`, `offset = (round(cursor.x - N.x), round(cursor.y - N.y))`, i.e.
the top left of the content goes to the cursor. Then, if the destination has no children, the offset
is replaced by `(round(-N.x), round(-N.y))` (28094 +11947). [code; reading the vcalls as "mouse position
in canvas space" is inferred]

## 3. Keep or centre inside a container (function 11879)

`11879(out, C, N, d)`, `C` the container bounds, `N` the content bounds, `d` the offset so far.
`N' = N + d`. [code, fully decoded]

```
if C.w >= N'.w && C.h >= N'.h:                      // size fits
    if intersects(C, N'):                           out = round(d)
    N'' = N' with x = C.cx - N'.w/2                 // centre horizontally, keep y
    if intersects(C, N''):                          out = round(centre(N'') - centre(N))
    N''' = N' with y = C.cy - N'.h/2                // centre vertically, keep x
    if intersects(C, N'''):                         out = round(centre(N''') - centre(N))
out = round(centre(C) - centre(N))                  // fallback: centre both axes
```

This is the help-center rule ("keep x/y if the frame can accommodate it, per axis, else centre on
that axis"): when the content does not intersect the frame at all, the axis (or axes) that are
disjoint get centred. "Accommodate" means any overlap, not full containment. When the content is
larger than the frame in either dimension both axes are centred.

Where it is used in 28094 [code]:
- 28094 +16533: after the offset is known, if `N + offset` does not intersect the destination
  container and the clipboard flag at bit 8 is clear: `if (container is f2128-flagged || C >= N in
  size) offset = 11879(C, N, offset) else offset = round(C.origin - N.origin)`.
- 28094 +15969 / +16065: single destination container, with `C = container ∩ V` (function 3514), `d = 0`:
  if the intersection is empty the offset is 0; if the destination is not the original parent the
  content is centred in `C` (function 28095); if it is the original parent the rule above applies.
  This is how "paste into a frame centres in the visible part of the frame".
- 28094 +8749 / +8860: multi-target (several selected containers): each target is tested with
  `d = 0`; if every target gives (0,0) the position is kept, otherwise content is centred per target.

## 4. Slides, Buzz, FigJam (not Design)

- Editor type is `byte[app.editorState + 80]`: 0 Design, 1 Whiteboard (FigJam), 2 Slides, 3 Dev
  handoff, 4 Sites, 5 Cooper (Buzz), 6 Illustration (enum `EditorType` in the Kiwi schema). [code]
- Slides branch in 28094 (+15067, +17735): constants 240 and 600, plus 1920 x 1080 in 24546
  (+3671/+3795) and 28094. The checks are "content taller than slide height + 600 or wider than slide
  width + 240" and a resize-on-paste (`slide-resize-on-paste`, `resize-pasted-nodes` scopes). Not
  decoded further. [code for the constants, rest unknown]
- FigJam, Slides and Buzz duplicate offset: function 12113 line ~234 adds `f12555(app)` to both x and
  y of the duplicate transform for editor types {1, 2, 5}; `f12555` returns 16 for exactly those
  types. In Design the offset is (0,0). [code]

## 5. After the paste: view adjustment (function 7674)

Called as `7674(selection, app, viewport, pan = 0, zoomMode, skipIfEmpty = 1)` at the end of
24546 (+10541), with `zoomMode = (pasteOption == 2) ? 4 : (destination has no children ? 1 : 2)`.
[code]

```
if selection is empty: return (skipIfEmpty)
if zoomMode == 1: viewport.vcall[+96]; return                // zoom to selection (inferred name)
S = bounds of the selection (function 2653)
V  = viewport rect (slot 28)
Vs = (V.x + V.w/16, V.y + V.h/16, V.w * 0.875, V.h * 0.875)  // safe area, 1/16 margin each side
per axis, with pan = 0: if S overlaps Vs on that axis: delta = 0
      else if S is smaller than Vs: delta = smallest move that brings S inside Vs
           (align the near edge: S.right - Vs.right or S.x - Vs.x)
      else (S larger than Vs): align S to the edge nearest its centre
pan the viewport by -delta * scale          // vtable slot 100 (inferred: pan by screen px)
recompute Vs from the new V
switch zoomMode:
  2: zoom to selection iff S contains Vs                       // function 2491(S, Vs)
  3: zoom to selection iff Vs does not contain S               // 2491(Vs, S)
  4: zoom to selection iff S is bigger than Vs in w or h       // 9295(Vs, S) false
  other: never
```
[code for the constants 0.875, 0.0625, 0.5 and the three tests; the per-axis delta formula was read
from the decompiled branches (7674 +190 .. +330) and has not been tested]

So after a normal paste into a non-empty destination (mode 2 above): pan only if the pasted content
does not overlap the safe area at all; zoom only if the content covers the whole safe area. After
paste into an empty destination: always zoom to fit the selection. After paste here: zoom to fit only
if the content is larger than 87.5 % of the view in w or h. The help-center sentences "if the pasted
object is larger than the view, Figma zooms to fit it" fits the last two; the first is stricter in the
code (needs to cover both dimensions of the safe area). [inferred]

Other callers of 7674 are 12113 (duplicate, `zoomMode 2`, `pan = !isIdentity(transform) || f32 != 0`),
14118, 28535, 32268, 44932, 46078, 46088 (not looked at).

## 6. Duplicate (function 12113)

Preconditions and order [code, decoded from the decompiled body]:

1. `selection = f1929(...)` returns the single selected node only when exactly one node is selected
   (entry list size 20 bytes, count 1) and a flag is clear; else no special placement.
2. Viewport `V` from slot 28. `R` = the node's bounds.
3. If `R` does not intersect `V`: the duplicate transform becomes a translation by
   `round(centre(V) - centre(R))` (centre the copy in the view). If it does intersect and the node
   is a SLICE (or the FigSpec case `l19`), the incoming transform is reset to identity.
4. The "next to" step runs only if all hold: `f7770(node)` (or the spec case), node type is not
   BOOLEAN_OPERATION (5) or VECTOR (6), not SHAPE_WITH_TEXT (18), not `f2763`, not (Dev handoff and
   `f14511`), the transform copy is the identity (`f4478`) and its rotation term (`f32[+2648]`) is 0.
   `f7770(node)` = `f3278(node)` and parent type is CANVAS (2), SLICE (14), RESPONSIVE_SET (39) or
   WEBPAGE (55). `f3278` accepts FRAME, BOOLEAN, VECTOR, STAR, LINE, ELLIPSE, RECTANGLE, TEXT,
   SLICE, SYMBOL, INSTANCE, STICKY, SHAPE_WITH_TEXT, CONNECTOR, CODE_BLOCK, WIDGET and a few more,
   minus anything `f2128` flags; GROUP and SECTION are not in the list. [code for the lists; what
   `f2128`'s flag means is unknown]
5. `6328(out, ctx, rect = transformed R, zero offset, parent = first insertion location, right)`:
   the copy is pushed to `right edge of the first colliding sibling + 40`, repeated. The original
   itself is the first collision, so a copy of a free-standing top-level layer lands 40 px right of the
   original, and a second Ctrl+D (original still selected, new copy is selected) lands 40 px right of
   the first copy. The delta is stored as a translation in the transform; a second matrix
   `translate(width + 40, 0)` is stored for repeat-duplicate sessions (the
   `DuplicateWithTransformTracker` / `DUPLICATE_SESSION_TOAST` strings).
6. Duplicates inside a frame (parent not the page) skip step 5, so they stay at the same position.
7. FigJam, Slides, Buzz: step 4's transform is a (16, 16) translation first, which is not the
   identity, so step 5 is skipped and copies are offset diagonally.

The `duplicate` and `duplicate-in-place` action ids both exist in the registry (chunk 86 around line
64615 / 65817; `duplicate-in-place` is the one bound to Ctrl+D in the keymap). Which C++ path each id
enters was not traced (the handlers are all `G.g8` dispatch). [guess] that both reach 12113.

## 7. Related constants found on the way (not paste)

- Template insertion (`TemplateHelpers::insert`, function 46021, error string "Could not paste
  template into scene."): when a template has no x/y it is placed with a 128 gap (functions 10233 and
  46247; `rect.x = max(right edges) + 128`, loop until free) or near the closest top-level frame
  (46248, constants 1500, 600, 400, 128). Not the same code as paste. [code]
- Component set / state group layout: `f4713` returns 16 for a flag and otherwise the f32 at
  `[app+520]+4904`, initial value 10.0, used as spacing by function 10269 (it appears inside the
  Paster scope `process-duplicated-states-in-selection`). [code for the numbers]
- `ce_paste_stack_absolute_pos` (string 851259, function 16786 is the flag read) and the visual bell
  `visual_bell.paste_absolute_position` (function 28735): pasting into an auto-layout stack with an
  absolute-position child shows a notice. Not placement. [code]
- `ce_dont_move_frame_when_zoomed` (flag function 11221, callers 29357, 47874, 49155, 50348, 50960)
  was not read; the name suggests a zoom dependent frame move. [guess]

## 8. Dead ends

- JS side: `handlePaste` and `pasteFromSerializedClipboardData` are thin wrappers; there is no
  placement constant in `85-*` or `86-*`. `pasteOffset` is only in the Kiwi schema string.
- `FGPaster.cpp` functions (6438, 10412, 11993, 13830, 18676, 18679, 28708 .. 28742, 34716 .. 34718,
  48524) are dependency, style, variable and state-group cloning. Their only float code is the
  state-group spacing (10269) and a "scan published symbols" pass (28737). No offsets.
- `10269` looks geometric at its tail but is a sorted insertion of duplicated variants (it splits
  comma separated position strings). Ignore it for frame placement.
- Functions 14485, 16052, 16053 (type 35 siblings of 28094) are grid layout, not paste.
- `getInsertionLocationsToPaste` (28097) itself only gathers `N`, reads `V` and picks locations; the
  offset is computed in 28094.

## 9. Where this got stuck

1. 28094 is one 19916-line function. The branch variables (`l40`, `l48`, `l54`, `l63`, `l79`, `l83`,
   `l85`, `l100`) were read as: explicit insertion list given, ?, table or multi-target mode, ?, ?,
   "all targets accept the position", "not exactly one location", "explicit or table". `l48`, `l63`
   and `l79` were not identified. Two virtual calls into the object at `app+476` (vtable slots 0, 4,
   8; types 15 and 35) resolve the insertion parent and may add an auto-layout related offset
   (28094 +14341, +14807, +16680). Their targets were not located; the vtable is reached through the
   `app` object so a static scan does not show it.
2. The flag at struct offset +100 of the clipboard info: bits 7, 8, 9 were identified only as
   "bit 9 = isCut" (analytics). Which of bits 7 and 8 is `pasteIsPartiallyOutsideEnclosingFrame` is a
   guess; bit 7 gates the next-to rule and bit 8 gates the container-fit step.
3. What the page node's bounds at +308 are (infinite? empty?). The container-fit code only makes
   sense if a page returns an infinite rect; this was not verified.
4. `f2128`, `f2025`, `f2730`: boolean predicates on node flags with unknown names (they decide which
   frames are "plain" and which siblings count as collisions).
5. The action registry maps `paste`, `paste-here`, `paste-over-selection`, `paste-to-replace`,
   `duplicate`, `duplicate-in-place` to C++ through string ids. The mapping to option 0/1/2/6 was
   not traced; only the enum names in function 29747 are known. Paste over selection and paste to
   replace placement (`inPasteToReplace`, `l50 == 1`, `(mode & ~2) == 4` in 28097) was not decoded.
6. Whether a copy placed by 6328 passes through the 2x guard after the push. It does by control flow
   (the guard is after all branches), but the guard may undo a push when the original sits at the
   edge of the view.

Tools used (kept outside the repo, in `~/.cache/figma-client-analysis/tools/`): `decomp.py` turns
one function's wat into readable pseudo code (needs `sigs.py` run once; collapses the ref-count
idiom into `DEREF`), `callers.py`/`cg.py`/`clos.py` for call graphs, `fconst.py` for float constants
per function, `elem.py` (table index to function index, for vtables and lambdas), `readmem.py`
(read bytes at a linear-memory address), `addrs.sh` (string to address), `fsum.sh`. Recipe: string
address -> `xref.py` -> `getfunc.sh`; for a function, `awk` its line range into a file and run
`decomp.py file 1 <length>`.

## 10. Open questions (experiments for the live editor)

Use a 400x300 frame `A` at (0,0) on an otherwise empty page unless stated. "Record" means read x/y
from the design panel. Repeat the interesting ones at zoom 1 and zoom 0.25 and with the frame
centred, half out of view, and fully out of view.

1. Select `A`, Ctrl+C, Ctrl+V. Expect x = 440, y = 0 (width 400 + gap 40). Paste again: expect 880
   (new copy is selected and is the same size as the clipboard root). Record.
2. Same, then press Escape before pasting (nothing selected). Expect (0,0), on top of `A`.
3. Select `A`, copy, then select a different frame `B` of a different size (and a third one `C` of
   the same size 400x300), paste. Tests `sameSize` vs `viaSameNode`. Expect: next to `B` only if `B`
   is 400x300 (the "same parent" part is B's parent equals the destination).
4. Select `A`, copy, then pan so `A` is entirely outside the view, select nothing, paste. Expect
   the copy centred in the view. Vary the pan distance to find the cut-off: expected exactly when the
   pasted rect leaves the 2x view (view size added 50 % on each side), at zoom 1 and zoom 0.25 (at
   0.25 the same canvas distance is a 4x smaller screen distance, so the cut-off in canvas units
   scales with the viewport).
5. Same as 4, but with `A` selected when pasting (nothing else selected): is the next-to push still
   applied, and is the result then re-centred by the guard? Tests the order of 2.2 and 2.4.
6. Copy a rectangle (not a frame) `R` at (0,0) and paste with `R` selected; then with a group, a
   section, a component, an instance. Which of them are pushed right? (Code predicts frames and
   slices only.)
7. Copy two frames and paste (selection of 2 is irrelevant, clipboard has 2 roots). Expect in place.
8. Ctrl+D on a top-level frame, rectangle, text, group, section, component, instance, vector,
   boolean. Code predicts a 40 px right push for frame, rectangle, text, component, instance and not
   for group, section, vector, boolean. Record each.
9. Ctrl+D with two frames selected; Ctrl+D on a frame inside a frame; Ctrl+D on a rotated top-level
   frame (rotation 10 degrees). Expect in place for all three.
10. Ctrl+D on `A` with a frame `X` already at x = 440 (so the first slot is taken): expect the copy
    right of `X`: x = 440 + width(X) + 40.
11. Ctrl+D with `A` fully outside the view: expect the copy centred in the view, then pushed right
    past anything under it.
12. Repeat Ctrl+D five times: positions should step by width + 40 each time.
13. Paste into an empty page (new page): expect the content top left at (0,0) and the view zooming to
    fit it.
14. Paste into an empty frame (select the frame, paste a rectangle copied elsewhere): expect the top
    left at the frame's (0,0) corner.
15. Paste into a non-empty frame `F` (600x400) a rectangle whose original position is (1000, 1000)
    relative to the page: expect centred in `F` (disjoint on both axes); then one at (100, 1000):
    expect x kept, y centred; then 800 wide: expect centred both. Tests section 3.
16. Paste here (context menu, cursor at a known canvas point P): expect top left at P. Try with P
    near the view edge and with content larger than the view (zoom to fit if > 87.5 % of the view).
17. Paste from another file (open two files) with a frame: expect centred on the viewport centre
    regardless of its original position (original not visible by definition).
18. After a normal paste, the view: copy a 3000 x 2000 frame at zoom 1 on a 1440 x 900 canvas and
    paste into a non-empty page with a small frame selected: code says zoom only if the pasted frame
    covers both dimensions of the safe area (87.5 % of the view); try a 3000 x 200 strip (expected:
    no zoom, maybe a pan) to check the "contains" test.
19. Check `flagF`: copy something that is partially outside its parent frame, then paste with the
    original selected; if the next-to push is skipped, bit 7 of the clipboard flags is
    `pasteIsPartiallyOutsideEnclosingFrame`.
20. Cursor dependence: does a plain Ctrl+V with the cursor over the canvas ever use the cursor? Code
    says no (only option 2 does). Verify by pasting with the cursor in two different places.
