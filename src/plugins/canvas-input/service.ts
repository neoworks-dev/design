import { Service, type Context } from '@neoworks/extension-system';
import type { ToolKeyEvent, ToolPointerEvent } from '../../lib/tools/protocol';
import { bindCanvasCursor } from './cursor.svelte';
import type { ModifierState } from './modifiers.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		canvasInput: CanvasInputService;
	}
}

const MIDDLE_BUTTON = 1;
const SECONDARY_BUTTON = 2;
export const MIDDLE_DRAG_TOOL_ID = 'hand';

/**
 * Turns DOM events on the canvas element into what the rest of the app consumes: tool input
 * (`tools.pointerDown/Move/Up/keyDown`), the `canvas/wheel` and `canvas/contextmenu` kernel
 * events, the cursor of the active tool, modifier state, and the `canvas` keymap scope while the
 * canvas has focus. Middle-drag borrows the hand tool, Space-hold is the tools service's `hold`.
 */
export class CanvasInputService extends Service {
	private pointerId: number | undefined;
	private middleDragActive = false;

	constructor(
		ctx: Context,
		readonly modifiers: ModifierState
	) {
		super(ctx, 'canvasInput');
	}

	/** Listen on `element` until the returned disposer runs. Every listener is an effect. */
	attach(element: HTMLCanvasElement): () => void {
		const disposers = [
			this.ctx.effect(() => this.listenPointer(element), 'canvas-input/pointer'),
			this.ctx.effect(() => this.listenKeyboard(element), 'canvas-input/keyboard'),
			this.ctx.effect(() => this.listenFocus(element), 'canvas-input/focus'),
			this.ctx.effect(() => this.listenWheelAndMenu(element), 'canvas-input/wheel and menu'),
			this.ctx.effect(() => bindCanvasCursor(this.ctx.tools, element), 'canvas-input/cursor')
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
		const leave = (): void => this.ctx.tools.pointerLeave();
		element.addEventListener('pointerleave', leave);
		return () => {
			element.removeEventListener('pointerleave', leave);
			element.removeEventListener('pointerdown', down);
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerup', up);
			element.removeEventListener('pointercancel', up);
			this.endMiddleDrag();
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
		if (event.button === MIDDLE_BUTTON) this.beginMiddleDrag();
		this.ctx.tools.pointerDown(this.toolEvent(element, event));
	}

	private onPointerMove(element: HTMLCanvasElement, event: PointerEvent): void {
		this.modifiers.update(event);
		this.ctx.tools.pointerMove(this.toolEvent(element, event));
	}

	private onPointerUp(element: HTMLCanvasElement, event: PointerEvent): void {
		this.modifiers.update(event);
		if (event.pointerId !== this.pointerId) return;
		this.pointerId = undefined;
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
		this.ctx.tools.pointerUp(this.toolEvent(element, event));
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
