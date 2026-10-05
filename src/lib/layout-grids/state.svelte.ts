// Reactive view state of the layout-grids plugin: whether grids are shown at all (Shift+G).
// Per-grid `visible` flags are document data; this is the view-wide switch on top of them.

export class LayoutGridsState {
	visible = $state(true);
}
