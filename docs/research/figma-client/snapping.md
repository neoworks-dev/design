# Snapping: Figma client evidence

## Preferences (editor preferences, user-level)

Read from wasm via `_EditorPreferences_Internal___getProperty_*`, written by action handlers that
flip the preference (`prefs.X.set(!prefs.X.getCopy())`). `[confirmed-in-code]`

| Preference | Action id | Shortcut | Notes |
| --- | --- | --- | --- |
| `snapToPixelGrid` | `toggle-snapping-to-pixels` | Ctrl/Cmd+Shift+' | "Snap to pixel grid" in the View menu |
| `snapToGeometry` | `toggle-snapping-to-geometry` | none in keymap | geometry (edges/centres of vector geometry) |
| `snapToObjects` | `toggle-snapping-to-objects` | none in keymap | objects (siblings, frames) |
| `snapToDotGrid` | `toggle-snapping-to-dots` | none | whiteboard (FigJam) only |
| `smallNudgeAmount` / `bigNudgeAmount` | `show-nudge-amount-picker` | none | defaults 1 and 10 |
| `showAllSnapTargetCandidates` | `debug-toggle-show-all-snap-target-candidates` | debug | draws every candidate |
| `stickyTools`, `flipDuringResize`, `keyboardZoomToSelection`, `invertZoom`, `scrollWheelZoom`, `rightClickPan`, `ctrlClickContextMenu`, `enableRotationShortcuts`, `setConstraintsAutomaticallyToggle`, `showMasks`, `renderRulers`, `renderGrid`, `showFrameGrids` | | | related canvas preferences |

Other string-table names: `snap-to-geometry`, `snap-to-objects`, `snap-to-frames`
(`snap-to-frames` has no visible toggle here; it may be derived from objects), `fsSnappingOverlay`,
`MutableCanvasSnapper`, `CanvasSnapper`.

## Snapper API (bindings in the glue)

- `CanvasSnapper`: `clearCache`, `clearSnappingVisualizations`, `addPostSnappingVisualizations`,
  `cacheTemporarySnapTargetsForLayoutGrids`; strings show targets cached per kind:
  `cacheSnapTargetsInContainer`, `cacheTemporarySnapTargetsForGaps`,
  `cacheTemporarySnapTargetsForImpliedFrameMargins`, `cacheTemporarySnapTargetsForGrids`,
  `cacheSnapTargetsForRotationOrigin`, `cacheSnapTargetsForTextPath`,
  `cacheSnapTargetsForVarWidthPoints`, `cacheSnapTargetsForTableSpan`.
  `[confirmed-in-code]` So Figma snaps to: edges/centres of nodes in the container, **gaps** (equal
  spacing), **implied frame margins**, layout grids and generic grids, plus tool-specific targets.
- `InteractionCpp`: `cacheSnapTargetsForSelection(snapper, nodeIds, mode, which)` with modes
  `AXIS` (and probably 'free') and a set selector such as `UNSELECTED_NODES`;
  `snapToPointDeltaPoint(snapper, point, threshold, viewportRect, axis)` returns the delta to add
  (axes `BOTH`, `HORIZONTAL`, `VERTICAL`); `snapPointAlongAxis`, `gridSnapBehavior`,
  `renderSnappingVisualizations`. Targets are limited to the **viewport rect** passed in
  (`eventViewport(e).canvasSpaceViewportRect()`). `[confirmed-in-code]`
- Snap result is applied as `point += delta` (not a re-position), and visualisations are cleared
  after reading. `[confirmed-in-code]` (connector tool in chunk 86).
- Per-event threshold `canvasSpaceSnappingThreshold()` is a virtual call (wasm func 44566 calls
  vtable slot 20 on the event; value not statically resolved). The nearby mouse threshold is
  `8 / scale` (func 44567). A sibling function (func 10470) returns `(flag ? 20 : 16) / scale`;
  whether it is the snapping threshold is `[guess]`. Candidate screen-px thresholds: 8, 16, 20.
  The live test (aligned edge 2 px away snapped) only proves the threshold is >= 2.

## Open questions

1. Snap engage distance: step the pointer from 20 px away to 0 from an edge at zoom 25 %, 100 %,
   400 %; find the largest offset that still pulls the node onto the edge. Compare with 8 / 16 / 20.
2. Hysteresis: is the release distance different from the engage distance?
3. Does the threshold scale with zoom (canvas units = px / zoom) or stay in screen px?
4. Which targets participate (parent edges, parent centre, siblings, nested children, other
   top-level frames, hidden/locked, rotated), and does the viewport limit hide offscreen targets?
5. Equal spacing (gaps) and implied frame margins: engage distance and labels.
6. With `snapToPixelGrid` on: positions round to integers; sizes too; interplay with object snap.
7. Which of snapToGeometry and snapToObjects controls which snap (turn each off and test edges vs
   vector points).
8. Ctrl/Cmd during drag disables snapping while held?
