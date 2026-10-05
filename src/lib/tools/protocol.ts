// The tool input protocol: what the canvas input router hands to the active tool, and the small
// state machine tools share so none of them re-implements "click versus drag". Pure: no Svelte,
// no kernel, no DOM.
//
// The router (separate issue) turns DOM pointer events into `ToolPointerEvent` (it knows the
// viewport, so it fills `world`) and calls `tools.pointerDown/Move/Up` and `tools.keyDown`.

export interface Point {
	x: number;
	y: number;
}

export interface Modifiers {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface ToolPointerEvent extends Modifiers {
	/** Position in canvas element pixels. */
	screen: Point;
	/** Position in document (world) coordinates; the router derives it from the viewport. */
	world: Point;
	/** `MouseEvent.button`: 0 primary, 1 middle, 2 secondary. */
	button: number;
	/** Click count of this press (2 for a double click). */
	detail: number;
	pointerId: number;
	/**
	 * World positions of the pointer samples the browser merged into this move event (coalesced
	 * events), oldest first, ending at `world`. Absent when the router has only this sample.
	 */
	coalesced?: Point[];
}

export interface ToolKeyEvent extends Modifiers {
	key: string;
	code: string;
	repeat: boolean;
	/** Stop the browser default (and the key reaching other handlers). */
	preventDefault(): void;
}

/** Pixels the pointer must travel from the press before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

export type GesturePhase = 'idle' | 'pressing' | 'dragging';

export interface GestureUpdate {
	phase: GesturePhase;
	/** True exactly once: the move that crossed the drag threshold. */
	startedDragging: boolean;
	/** Screen-space distance from the press point. */
	delta: Point;
}

export type GestureEnd = 'click' | 'drag' | 'none';

/**
 * `idle -> pressing -> dragging` for one pointer gesture, measured in screen space so the
 * threshold feels the same at every zoom level.
 *
 *   down: gesture.press(event.screen)
 *   move: if (gesture.move(event.screen).startedDragging) beginDrag()
 *   up:   if (gesture.release() === 'click') place()
 */
export class PointerGesture {
	phase: GesturePhase = 'idle';
	private origin: Point = { x: 0, y: 0 };

	constructor(private readonly threshold: number = DRAG_THRESHOLD_PX) {}

	get start(): Point {
		return this.origin;
	}

	press(point: Point): void {
		this.origin = { x: point.x, y: point.y };
		this.phase = 'pressing';
	}

	move(point: Point): GestureUpdate {
		const delta = { x: point.x - this.origin.x, y: point.y - this.origin.y };
		if (this.phase !== 'pressing') {
			return { phase: this.phase, startedDragging: false, delta };
		}
		if (Math.hypot(delta.x, delta.y) < this.threshold) {
			return { phase: this.phase, startedDragging: false, delta };
		}
		this.phase = 'dragging';
		return { phase: this.phase, startedDragging: true, delta };
	}

	/** What the gesture turned out to be; the gesture is idle afterwards. */
	release(): GestureEnd {
		const was = this.phase;
		this.phase = 'idle';
		if (was === 'pressing') return 'click';
		if (was === 'dragging') return 'drag';
		return 'none';
	}

	/** Abort (Esc, tool switch): idle without producing a click or a drag. */
	cancel(): void {
		this.phase = 'idle';
	}
}
