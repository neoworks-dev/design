import { Service, type Context } from '@neoworks/extension-system';
import type { ToolKeyEvent, ToolPointerEvent } from '../../lib/tools/protocol';
import { Registry } from '../../lib/registries/registry.svelte';
import type { PointerClaimant, PointerGrab } from '../../lib/tools/claim';
import { bindCanvasCursor, type CursorOverride } from './cursor.svelte';
import type { ModifierState } from './modifiers.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		canvasInput: CanvasInputService;
	}
}

const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const SECONDARY_BUTTON = 2;
const DOUBLE_CLICK_MILLISECONDS = 500;
const DOUBLE_CLICK_DISTANCE = 5;
export const MIDDLE_DRAG_TOOL_ID = 'hand';

/**
 * Turns DOM events on the canvas element into what the rest of the app consumes: tool input
 * (`tools.pointerDown/Move/Up/keyDown`), the `canvas/wheel` and `canvas/contextmenu` kernel
 * events, the cursor of the active tool, modifier state, and the `canvas` keymap scope while the
 * canvas has focus. Middle-drag borrows the hand tool, Space-hold is the tools service's `hold`.
 */
export class CanvasInputService extends Service {
	/** Interactive overlay parts that take a press before the active tool does. */
	readonly claimants = new Registry<PointerClaimant>();
	private pointerId: number | undefined;
	private middleDragActive = false;
	private grab: PointerGrab | undefined;
	private lastPress: { time: number; x: number; y: number; count: number } | undefined;

	constructor(
		ctx: Context,
		readonly modifiers: ModifierState,
		private readonly cursorOverride: CursorOverride
	) {
		super(ctx, 'canvasInput');
	}

	/** Registers a claimant; the disposer also cancels a grab still running. */
	claim(claimant: PointerClaimant): () => void {
		const dispose = this.claimants.register(claimant);
		return () => {
			dispose();
			this.cancelGrab();
		};
	}

	private cancelGrab(): void {
		const grab = this.grab;
		this.grab = undefined;
		grab?.cancel();
	}

	private claimAt(event: ToolPointerEvent): PointerGrab | undefined {
		for (const claimant of this.claimants.list()) {
			const grab = claimant.claim(event);
			if (grab !== undefined) return grab;
		}
		return undefined;
	}

	/** Returns whether the pointer rests on a claimant. */
	private updateCursorOverride(event: ToolPointerEvent): boolean {
		for (const claimant of this.claimants.list()) {
			const cursor = claimant.cursorAt?.(event);
			if (cursor === undefined) continue;
			this.cursorOverride.value = cursor;
			return true;
		}
		this.cursorOverride.value = undefined;
		return false;
	}

	/** Listen on `element` until the returned disposer runs. Every listener is an effect. */
	attach(element: HTMLCanvasElement): () => void {
		const disposers = [
			this.ctx.effect(() => this.listenPointer(element), 'canvas-input/pointer'),
			this.ctx.effect(() => this.listenKeyboard(element), 'canvas-input/keyboard'),
			this.ctx.effect(() => this.listenFocus(element), 'canvas-input/focus'),
			this.ctx.effect(() => this.listenWheelAndMenu(element), 'canvas-input/wheel and menu'),
			this.ctx.effect(
				() => bindCanvasCursor(this.ctx.tools, this.cursorOverride, element),
				'canvas-input/cursor'
			)
		];
		return () => disposers.reverse().forEach((dispose) => void dispose());
	}

	snapshotState(): unknown {
		return { capturing: this.pointerId !== undefined };
	}

	// ---------- pointer ----------

	private listenPointer(element: HTMLCanvasElement): () => void {
		const down = (event: PointerEvent): void => this.onPointerDown(element, event);
		const move = (event: PointerEvent): void => this.onPointerMove(element, event);
		const up = (event: PointerEvent): void => this.onPointerUp(element, event);
		element.addEventListener('pointerdown', down);
		element.addEventListener('pointermove', move);
		element.addEventListener('pointerup', up);
		element.addEventListener('pointercancel', up);
		const leave = (): void => {
			this.cursorOverride.value = undefined;
			this.ctx.tools.pointerLeave();
		};
		element.addEventListener('pointerleave', leave);
		return () => {
			element.removeEventListener('pointerleave', leave);
			element.removeEventListener('pointerdown', down);
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerup', up);
			element.removeEventListener('pointercancel', up);
			this.endMiddleDrag();
			this.cancelGrab();
			this.cursorOverride.value = undefined;
			this.pointerId = undefined;
		};
	}

	private onPointerDown(element: HTMLCanvasElement, event: PointerEvent): void {
		this.modifiers.update(event);
		element.focus({ preventScroll: true });
		// The secondary button belongs to the context menu, not to tools.
		if (event.button === SECONDARY_BUTTON) return;
		if (this.pointerId !== undefined) return;
		this.pointerId = event.pointerId;
		element.setPointerCapture(event.pointerId);
		event.preventDefault();
		const toolEvent = this.toolEvent(element, event);
		if (event.button === PRIMARY_BUTTON) {
			this.grab = this.claimAt(toolEvent);
			if (this.grab !== undefined) return;
		}
		if (event.button === MIDDLE_BUTTON) this.beginMiddleDrag();
		this.ctx.tools.pointerDown({ ...toolEvent, detail: this.clickCount(event) });
	}

	/**
	 * Pointer events carry no click count (`detail` is 0 for them), so count presses close in time
	 * and space here: 2 is a double click.
	 */
	private clickCount(event: PointerEvent): number {
		const previous = this.lastPress;
		let count = 1;
		if (previous !== undefined) {
			const close =
				Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_CLICK_DISTANCE;
			if (close && event.timeStamp - previous.time <= DOUBLE_CLICK_MILLISECONDS) {
				count = previous.count + 1;
			}
		}
		this.lastPress = { time: event.timeStamp, x: event.clientX, y: event.clientY, count };
		return Math.max(event.detail, count);
	}

	private onPointerMove(element: HTMLCanvasElement, event: PointerEvent): void {
		this.modifiers.update(event);
		const toolEvent = this.toolEvent(element, event);
		if (this.grab !== undefined) {
			this.grab.move(toolEvent);
			return;
		}
		if (this.pointerId === undefined && this.updateCursorOverride(toolEvent)) return;
		this.ctx.tools.pointerMove(toolEvent);
	}

	private onPointerUp(element: HTMLCanvasElement, event: PointerEvent): void {
		this.modifiers.update(event);
		if (event.pointerId !== this.pointerId) return;
		this.pointerId = undefined;
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
		const toolEvent = this.toolEvent(element, event);
		const grab = this.grab;
		this.grab = undefined;
		if (grab !== undefined) {
			grab.up(toolEvent);
			return;
		}
		this.ctx.tools.pointerUp(toolEvent);
		this.endMiddleDrag();
	}

	private beginMiddleDrag(): void {
		if (this.ctx.tools.activeId() === MIDDLE_DRAG_TOOL_ID) return;
		if (!this.ctx.tools.get(MIDDLE_DRAG_TOOL_ID)) return;
		this.ctx.tools.pushTemporary(MIDDLE_DRAG_TOOL_ID);
		this.middleDragActive = true;
	}

	private endMiddleDrag(): void {
		if (!this.middleDragActive) return;
		this.middleDragActive = false;
		this.ctx.tools.pop(MIDDLE_DRAG_TOOL_ID);
	}

	private toolEvent(element: HTMLCanvasElement, event: PointerEvent): ToolPointerEvent {
		const box = element.getBoundingClientRect();
		const screen = { x: event.clientX - box.left, y: event.clientY - box.top };
		return {
			screen,
			world: this.ctx.viewport.screenToWorld(screen),
			button: event.button,
			detail: event.detail,
			pointerId: event.pointerId,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey
		};
	}

	// ---------- keyboard and focus ----------

	private keyEvent(event: KeyboardEvent): ToolKeyEvent {
		return {
			key: event.key,
			code: event.code,
			repeat: event.repeat,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			preventDefault: () => event.preventDefault()
		};
	}

	private listenKeyboard(element: HTMLCanvasElement): () => void {
		const keydown = (event: KeyboardEvent): void => {
			this.modifiers.update(event);
			if (!this.ctx.tools.keyDown(this.keyEvent(event))) return;
			event.preventDefault();
			// The window-level keymap must not see a key the tool used.
			event.stopPropagation();
		};
		const keyup = (event: KeyboardEvent): void => {
			this.modifiers.update(event);
			this.ctx.tools.keyUp(this.keyEvent(event));
		};
		element.addEventListener('keydown', keydown);
		element.addEventListener('keyup', keyup);
		return () => {
			element.removeEventListener('keydown', keydown);
			element.removeEventListener('keyup', keyup);
		};
	}

	// The canvas needs tabindex to take focus; the previous value comes back on dispose.
	private listenFocus(element: HTMLCanvasElement): () => void {
		const previousTabIndex = element.getAttribute('tabindex');
		element.tabIndex = 0;
		element.style.outline = 'none';
		let popScope: (() => void) | undefined;
		const focus = (): void => {
			if (popScope) return;
			popScope = this.ctx.keymap.pushScope('canvas');
		};
		const blur = (): void => {
			popScope?.();
			popScope = undefined;
		};
		element.addEventListener('focus', focus);
		element.addEventListener('blur', blur);
		if (document.activeElement === element) focus();
		return () => {
			element.removeEventListener('focus', focus);
			element.removeEventListener('blur', blur);
			blur();
			element.style.outline = '';
			if (previousTabIndex === null) element.removeAttribute('tabindex');
			else element.setAttribute('tabindex', previousTabIndex);
		};
	}

	// ---------- wheel, context menu, modifiers, cursor ----------

	// Not passive: pan and zoom handlers must be able to stop the page from scrolling or zooming.
	private listenWheelAndMenu(element: HTMLCanvasElement): () => void {
		const wheel = (event: WheelEvent): void => {
			const box = element.getBoundingClientRect();
			this.ctx.emit('canvas/wheel', {
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				ctrlKey: event.ctrlKey,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
				screen: { x: event.clientX - box.left, y: event.clientY - box.top },
				preventDefault: () => event.preventDefault()
			});
		};
		const contextmenu = (event: MouseEvent): void => this.ctx.emit('canvas/contextmenu', event);
		element.addEventListener('wheel', wheel, { passive: false });
		element.addEventListener('contextmenu', contextmenu);
		return () => {
			element.removeEventListener('wheel', wheel);
			element.removeEventListener('contextmenu', contextmenu);
		};
	}
}
