// Drag-to-reorder for the rows of an inspector list (paints, effects). The grip captures the
// pointer; on release the row under the pointer is the target. One `move` call, so one undo step.

/** Start tracking a grip drag. `rowAttribute` is the data attribute holding each row's index. */
export function startRowDrag(
	event: PointerEvent,
	list: HTMLElement,
	rowAttribute: string,
	index: number,
	move: (from: number, to: number) => void
): void {
	const grip = event.currentTarget;
	if (!(grip instanceof HTMLElement)) return;
	grip.setPointerCapture(event.pointerId);
	const finish = (upEvent: PointerEvent): void => {
		grip.removeEventListener('pointerup', finish);
		const rows = [...list.querySelectorAll<HTMLElement>(`[${rowAttribute}]`)];
		const hit = rows.find((row) => {
			const box = row.getBoundingClientRect();
			return upEvent.clientY >= box.top && upEvent.clientY < box.bottom;
		});
		if (hit === undefined) return;
		const target = Number(hit.getAttribute(rowAttribute));
		if (target !== index) move(index, target);
	};
	grip.addEventListener('pointerup', finish);
}
