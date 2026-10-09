# Moving elements: Figma client evidence

Sources: pass 2 dump (see `README.md`). Tags: `[confirmed-in-code]`, `[inferred]`, `[guess]`.
`[measured]` marks facts from the live Figma lab (`docs/references/figma-lab/<experiment>/report.md`,
local and gitignored; experiment folders there: drag-threshold, snap-distance, nudge, shift-axis-lock,
alt-duplicate, escape-and-undo, control-during-drag, auto-layout-reorder, reparent-frame,
multi-selection-click).

## 1. Drag start threshold

- A press becomes a drag when the pointer has moved **more than 5 screen px** (Euclidean distance,
  `> 5`, not per axis). Wasm func 50204 computes `sqrt(dx*dx + dy*dy)` between the current pointer
  (event +48/+56) and the press point (+120/+128) in a state machine and, when the distance exceeds
  5.0, logs "moved beyond threshold, starting drag" and switches state. `[confirmed-in-code]`
  Matches the measurement (>= 5 engages, 4 does not, zoom independent) `[measured]`; the
  distance is in viewport (screen) coordinates, which explains the zoom independence.
  (The lab saw 5 engage; an exact 5.0 would not satisfy `> 5`. Most likely the lab's 5 px move
  arrives as a sub-pixel or rounded position; treat "5 px of travel" as the reference and test 5.0
  exactly with integer pointer coordinates. `[open]`)
- The same recogniser family has a **click** variant: if the pointer moves farther than the "max
  distance allowed" the click fails ("failing, moved too far"). The max is **5 px, or 10 px when a
  byte on the event (offset +104, the pointer type) is not 1 or 2**. Types 1 and 2 are probably
  mouse and pen, the rest touch. Funcs 47223, 48870, 49415, 49422 (all log "distance moved" vs
  "max distance allowed"). `[confirmed-in-code]` for the numbers, `[guess]` for the pointer type mapping.
  Consequence: below 5 px a press-release is still a click (no move, selection change on mouse-up).
- Touch has extra rules: "touch was down for too long to be a tap", "moved too far before touch was
  held long enough", and a `LongPressMultiselectDrag` mode. The class
  `HandSelectMoveNodeGestureRecognizer` logs "Distance past threshold, now allowing movement",
  "Moved far enough, beginning", "delayed move beginning", "Moved quickly past threshold, discarding
  potential selection, failing", "Got a movement, and enough time elapsed, selecting". `[confirmed-in-code]`
  (touch path only; not needed for a desktop clone).
- A separate **8 px / zoom** value exists: `MouseBehaviorEvent.canvasSpaceMouseThreshold()` (wasm
  func 44567) returns `8 / viewportScale` as f32, i.e. 8 screen px expressed in canvas units. It is
  exposed to behaviours (JS has `canvasSpaceMouseThreshold()` on the event) but the drag-start code
  above uses 5 screen px directly. Purpose of the 8 is unknown, `[guess]` hit tolerance/slop for
  hover and pen tools.

## 2. Jump on engage, back-to-start, rounding

- Jump by the full pointer delta when the threshold is crossed, and moving back to the press point
  keeps the drag. `[measured]` Code-wise this fits a one-way state transition (possible -> began) in
  func 3030 (a setter that writes the new state to `+60`); nothing re-arms. `[inferred]`
- Whole-pixel rounding at 400 % (1.25 -> 1, 1.5 -> 2, i.e. round half up) `[measured]`. In code:
  the preference `snapToPixelGrid` is a separate toggle (see `snapping.md`), so the plain rounding
  is not the pixel-grid snap. `[inferred]` The connector tool compares snapped positions with
  `Math.round(event.canvasSpaceMouse())`, so mouse positions are rounded to integer canvas
  coordinates before snapping. `[confirmed-in-code]` (chunk 86, connector tool; likely shared).

## 3. Modifier keys and drag variants

- Telemetry/action names for drag kinds in the wasm string table: `move-selection-drag`,
  `duplicate-selection-on-alt-drag`, `option-drag`, `center-resize-drag`, `rotate_drag`,
  `layer_update_drag`, `box_select_matching_drag`, `frame_tool_drag`, `mouse_drag`,
  `quick_create_from_drag`, `inline_quick_add_drag`, `ve_move_drag`, `ve_bend_drag`, `ve_pen_drag`,
  `opt_drag`. `[confirmed-in-code]` Alt-drag duplicate is its own tracked action
  (`duplicate-selection-on-alt-drag`, scope `DuplicateSelection`), so duplication happens inside
  the move behaviour, not as a separate command. `[inferred]`
- The event object exposes exactly: `isShiftPressed`, `isAltPressed`, `isMetaPressed`,
  `isStandardShortcutKeyPressed` (Cmd on mac, Ctrl elsewhere), `clickCount`, `isOverSelection`,
  `findHoveredNodeId`, `wasCanceled`, `selectionNodeGUIDs`, `canvasSpaceMouse`,
  `viewportSpaceMouse`, `canvasSpaceMouseThreshold`, `canvasSpaceSnappingThreshold`.
  `[confirmed-in-code]` (`MouseBehaviorEvent_Internal_*` in the glue). No separate Space flag on
  the event: Space (pan, and "keep nesting while dragging") is handled outside, probably in the
  viewport or tool layer. `[inferred]`
- Shift axis lock in the connector tool: the code checks whether the snapped x equals the rounded
  mouse x to decide VERTICAL vs HORIZONTAL snapping; the move behaviour likely uses a similar
  `AXIS` snap mode (`snapPointAlongAxis` exists on `InteractionCpp`). `[inferred]`
- `Escape` is just `escape` (GLOBAL); `MouseBehaviorEvent.wasCanceled()` signals a cancelled drag
  to the behaviour, and "cancelled mouseup" is a logged string. `[confirmed-in-code]`
- `Ctrl/Cmd+D` is `duplicate-in-place` (see `shortcuts.md`). This contradicts the "duplicate with
  repeated offset" idea in `interactions.md` section 12 and section 2 (Arrange): the action id is
  explicitly "in place". `[confirmed-in-code]` Whether a repeat offset exists after a duplicate+move
  is still open.

## 4. Reparenting and auto layout

- Wasm strings: `reparentIntoStackInfo` (UI state read by JS, i.e. the "will drop into this auto
  layout" feedback), `dragAndDropStackInsertion`, `forStackInsertion`, `stackInsertionDebugMode`
  (editor preference, debug), `isDraggingChildren` (canvas grid), `FGMoveSelectionLayoutHelpers.cpp`
  and `FGStacking.cpp`. `[confirmed-in-code]` for the existence of a stack insertion path distinct
  from plain reparent. Details (midpoint rules, escape distance) are in C++ and not decoded.
- Reparent validation messages: reparenting into a component/template/webpage is refused for
  disallowed node types, component cycles are blocked ("Reparenting would create a component
  cycle", "...component inside a component"). `[confirmed-in-code]` Replicate as rules in
  `ctx.document.apply` validation.
- Timers in the move behaviour constructor (func 48913, the only function referencing
  `FGMoveSelectionBehavior.cpp` that builds the behaviour): timers of **350 ms** and **1000 ms** are
  created and a comparison `now - lastTime <= 0.35 s` exists; also an `8` passed to a helper.
  `[confirmed-in-code]` for the numbers, `[guess]` for meaning (hover-delay before spring-loaded
  reparent / auto layout re-evaluation, and a 1 s idle reset). Needs an experiment.

## 5. Nudge

- `NudgeForKeyEvent` handles arrow keys in C++ (no arrow rows in the keymap JSON).
  Preferences `smallNudgeAmount` (default **1**) and `bigNudgeAmount` (default **10**) live in
  `editorPreferences`; JS hooks default them with `?? 1` / `?? 10`. Numeric inputs use the same two
  values for Up/Down and Shift+Up/Down (and `0.01` / `0.1` for time fields, `1` / `10` seconds). The
  UI action `show-nudge-amount-picker` ("Nudge amount") edits them. `[confirmed-in-code]`
  Big nudge is the Shift variant. `[inferred]`

## 6. Resize/rotate quick facts

- Resize has centre variants (`center-resize-drag`); rotation has `enableRotationShortcuts` pref and
  `show-rotation-origin` (Alt+R). Corner rotation is `FGCornerRotationBehavior`. Resize pref
  `flipDuringResize` (flip when dragging through the opposite edge, user toggle). `[confirmed-in-code]`

## Open questions (experiments for the live session)

Done: drag threshold, jump on engage, back-to-start (measured, see
`docs/references/figma-lab/drag-threshold/report.md`).

1. Exactly-5.0 case: with integer pointer events, does a move of exactly 5 px (dx=5, dy=0) engage? And
   dx=3, dy=4 (distance 5.0)? And dx=4, dy=3.01? (Settles `> 5` vs `>= 5` and Euclidean vs per-axis.)
2. Mouse vs pen vs touch: does 10 px apply with pointerType=touch / pen in CDP `Input.dispatchTouchEvent`?
3. The 8/zoom value: is hover or snap-to-edge-of-hover using 8 screen px? Test hover highlight and
   the Alt-measure at 7 and 9 px from an edge.
4. 350 ms and 1000 ms timers: hold the pointer still over an auto layout frame for 300/400 ms and
   1.1 s while dragging a child; does the insertion indicator or reparent target change at those times?
5. Shift lock: does it lock to the dominant axis of the total delta or to the first axis crossed;
   does it flip near 45 degrees; is the lock released when Shift is released mid drag?
6. Alt-drag: duplicate at press, at threshold or at release; Alt pressed after drag start; released mid drag.
7. Escape: node returns to start and undo stack unchanged; Alt duplicate removed.
8. Space during drag: pan, reparent block, or both.
9. Ctrl/Cmd during drag: disables snapping only; deep select; absolute position inside auto layout.
10. Duplicate in place then move then Ctrl+D again: offset repeated?
11. Reparent rule: pointer inside frame vs overlap/centre; leaving a frame; dropping on a frame with
    clip on/off; hidden or locked frames.
12. Auto layout: insertion line vs neighbour midpoints; vertical escape distance; Ctrl behaviour.
13. Nudge: arrow 1, Shift+arrow 10, changed prefs, rotated nodes, multi-selection, nudge inside
    auto layout, coalescing into one undo step.
14. Pixel rounding for multi-selection and rotated nodes, with and without `snapToPixelGrid`.
