// Where a dragged page lands in the pages list: pure arithmetic on the pointer position.

export const PAGE_ROW_HEIGHT = 28;

export interface PageDropTarget {
	/** The insertion line sits above the row with this index (0 to page count). */
	slot: number;
	/** Index the page has once moved, among the pages without it: what `reorderPage` takes. */
	position: number;
}

export function pageDropTarget(
	contentY: number,
	pageCount: number,
	draggedIndex: number
): PageDropTarget {
	const slot = Math.max(0, Math.min(pageCount, Math.round(contentY / PAGE_ROW_HEIGHT)));
	let position = slot;
	if (slot > draggedIndex) position = slot - 1;
	return { slot, position };
}
