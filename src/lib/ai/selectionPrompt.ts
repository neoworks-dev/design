// Where the canvas AI button and its prompt card sit, next to the top right corner of the
// selection (as in Figma). Pure: screen rects in, screen positions out.

import type { Rect } from '../document';
import type { Point } from '../tools/protocol';

/** Menu whose items are the suggestions under the focused, empty prompt (plugins contribute). */
export const PROMPT_SUGGESTIONS_MENU = 'ai/prompt-suggestions';
/** Menu of the prompt's plus button. */
export const PROMPT_ADD_MENU = 'ai/prompt-add';

/** Side of the square sparkle button, in canvas pixels. */
export const BUTTON_SIZE = 28;
/** Space between the selection's corner and the button. */
export const BUTTON_GAP = 8;
/** Size of the prompt card that opens right of the button. */
export const CARD_WIDTH = 340;
export const CARD_HEIGHT = 56;
/** How far around the corner the pointer counts as heading for the button. */
const HOT_ZONE_REACH = 64;
const EDGE_MARGIN = 8;

/** The button's top left: outside the selection, above its top right corner, kept on canvas. */
export function buttonPosition(selection: Rect, canvas: { width: number; height: number }): Point {
	const right = selection.x + selection.width;
	const x = clamp(right + BUTTON_GAP, EDGE_MARGIN, canvas.width - BUTTON_SIZE - EDGE_MARGIN);
	const y = clamp(
		selection.y - BUTTON_GAP - BUTTON_SIZE,
		EDGE_MARGIN,
		canvas.height - BUTTON_SIZE - EDGE_MARGIN
	);
	return { x, y };
}

/** Whether the pointer is near enough the selection's top right corner to show the button. */
export function inHotZone(pointer: Point, selection: Rect, button: Point): boolean {
	const right = selection.x + selection.width;
	const nearCorner =
		pointer.x >= right - HOT_ZONE_REACH &&
		pointer.x <= right + HOT_ZONE_REACH &&
		pointer.y >= selection.y - HOT_ZONE_REACH &&
		pointer.y <= selection.y + HOT_ZONE_REACH;
	if (nearCorner) return true;
	return (
		pointer.x >= button.x - EDGE_MARGIN &&
		pointer.x <= button.x + BUTTON_SIZE + EDGE_MARGIN &&
		pointer.y >= button.y - EDGE_MARGIN &&
		pointer.y <= button.y + BUTTON_SIZE + EDGE_MARGIN
	);
}

/** The card's top left: right of the button, or left of it when the canvas ends. */
export function cardPosition(button: Point, canvas: { width: number; height: number }): Point {
	let x = button.x + BUTTON_SIZE + BUTTON_GAP;
	if (x + CARD_WIDTH > canvas.width - EDGE_MARGIN) x = button.x - BUTTON_GAP - CARD_WIDTH;
	x = Math.max(EDGE_MARGIN, x);
	const y = clamp(button.y, EDGE_MARGIN, canvas.height - CARD_HEIGHT - EDGE_MARGIN);
	return { x, y };
}

function clamp(value: number, minimum: number, maximum: number): number {
	if (maximum < minimum) return minimum;
	return Math.min(Math.max(value, minimum), maximum);
}
