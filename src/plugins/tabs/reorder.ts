/**
 * Where a dragged tab would drop: the index of the first tab whose middle lies right of the
 * pointer, or the tab count when the pointer is past them all.
 */
export function dropIndexAt(pointerX: number, rects: { left: number; width: number }[]): number {
	for (let index = 0; index < rects.length; index += 1) {
		const middle = rects[index].left + rects[index].width / 2;
		if (pointerX < middle) return index;
	}
	return rects.length;
}
