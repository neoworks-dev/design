// Tools: canvas tools (Move, Rectangle, Pen, ...) are plugins that register through this service.
//
// Provided by plugin `core-tools` as `ctx.tools`:
//
//   ctx.effect(
//   	() =>
//   		ctx.tools.register({
//   			id: 'rectangle', title: 'Rectangle', icon: SquareIcon, shortcut: 'R',
//   			cursor: 'crosshair', group: 'shapes',
//   			onPointerDown: (event) => ...
//   		}),
//   	'rectangle tool'
//   );
//
// `register` adds the tool, the command `tools.activate.<id>`, the shortcut and the toolbar entry
// (the toolbar renders from the registry); one disposer removes all of it.
//
// Behaviour, per docs/research/interactions.md section 1:
// - `activate(id)` switches the tool; the default tool (`move`) is the resting state.
// - Sticky: a tool finishes with `completeOperation()` and the service reverts to the default
//   tool, unless the tool is locked (double click on its toolbar icon).
// - Temporary: `pushTemporary(id)` / `pop()` for hold-to-use tools (Space = hand, Z = zoom); the
//   previous tool comes back. A tool can declare `hold: 'Space'` to get that wiring.
// - Esc (`cancel()`): the tool's `onCancel` first (it returns true when it aborted an operation),
//   then a non-default tool reverts to the default tool.
// - Input: the canvas input router calls `pointerDown/Move/Up` and `keyDown`; they go to the
//   active tool. Tools use `PointerGesture` (lib/tools/protocol.ts) for click versus drag.

import { Service, type Context } from '@neoworks/extension-system';
import { untrack, type Component } from 'svelte';
import { callerContext } from '../kernel/caller';
import type { ToolKeyEvent, ToolPointerEvent } from '../tools/protocol';
import type { CommandsService } from './commands.svelte';
import type { ContextKeysService } from './contextKeys.svelte';
import type { KeymapService, KeyScope } from './keymap.svelte';
import { Registry, type RegistryEntry } from './registry.svelte';
import type { RegionEntry } from './regions.svelte';

// Contributed components have arbitrary props, see RegionContribution.
// oxlint-disable-next-line typescript/no-explicit-any
type AnyComponent = Component<any>;

/**
 * What an overlay draw function paints on. The renderer issue extends this interface (declaration
 * merging) with its drawing API; the size is all the protocol itself promises.
 */
export interface OverlaySurface {
	readonly width: number;
	readonly height: number;
}

export interface ToolOverlay {
	/** A Svelte component rendered in the `canvas-overlay` region while the tool is active. */
	component?: AnyComponent;
	props?: Record<string, unknown>;
	/** Painted by the renderer's overlay layer each frame while the tool is active. */
	draw?: (surface: OverlaySurface) => void;
}

export interface ToolContribution {
	id: string;
	title: string;
	icon?: AnyComponent;
	/** Chord that activates the tool, for example `R`. */
	shortcut?: string;
	/** Keymap scope of the shortcut. Defaults to `global` (which never fires while typing). */
	scope?: KeyScope;
	/** Hold this key to use the tool temporarily (Space for hand, Z for zoom). */
	hold?: string;
	/** CSS cursor over the canvas while active; a function may read runes. */
	cursor?: string | (() => string);
	/** Toolbar grouping: a separator is drawn where the group changes. */
	group?: string;
	/**
	 * Tools sharing a `toolbarGroup` form one toolbar button that shows the last-used member and a
	 * dropdown with the others (Frame / Section / Slice). Members are reachable through the
	 * dropdown even when `toolbar` is false.
	 */
	toolbarGroup?: string;
	order?: number;
	/** Context-key expression; the tool is unavailable (and hidden) while false. */
	when?: string;
	/** Set false for tools that are not on the toolbar (hand, zoom). Defaults to true. */
	toolbar?: boolean;
	overlay?: ToolOverlay;

	onPointerDown?(event: ToolPointerEvent): void;
	onPointerMove?(event: ToolPointerEvent): void;
	onPointerUp?(event: ToolPointerEvent): void;
	/** The pointer left the canvas (hover feedback ends). */
	onPointerLeave?(): void;
	/** Return true when the key was used. */
	onKey?(event: ToolKeyEvent): boolean | void;
	/** A key came up on the canvas (Space released during a gesture). */
	onKeyUp?(event: ToolKeyEvent): void;
	onActivate?(): void;
	onDeactivate?(): void;
	/** Esc: abort the operation in progress and return true; return false when idle. */
	onCancel?(): boolean;
}

export interface ToolEntry extends RegistryEntry {
	tool: ToolContribution;
	command: string;
	/** The overlay component bound to the plugin that registered the tool. */
	overlayContent?: RegionEntry;
}

export class UnknownToolError extends Error {
	constructor(readonly toolId: string) {
		super(`unknown tool "${toolId}"`);
		this.name = 'UnknownToolError';
	}
}

export const DEFAULT_TOOL_ID = 'move';

/** Which tool is active. Not a Service, so runes are fine. */
export class ToolsState {
	/** The tool chosen on the toolbar or by shortcut. */
	baseId = $state(DEFAULT_TOOL_ID);
	/** Hold-to-use tools stacked above the base tool; the last one is active. */
	temporaryIds = $state.raw<readonly string[]>([]);
	/** The base tool stays active after an operation (double click on its icon). */
	locked = $state(false);
}

declare module '@neoworks/extension-system' {
	interface Context {
		tools: ToolsService;
	}
}

export function activateToolCommandId(toolId: string): string {
	return `tools.activate.${toolId}`;
}

export class ToolsService extends Service {
	readonly registry: Registry<ToolEntry>;
	readonly state: ToolsState;

	/** Dependencies are captured from the providing plugin's ctx (see CommandsService). */
	constructor(
		ctx: Context,
		private readonly commands: CommandsService,
		private readonly keymap: KeymapService,
		private readonly contextKeys: ContextKeysService,
		state: ToolsState
	) {
		super(ctx, 'tools');
		this.registry = new Registry<ToolEntry>();
		this.state = state;
	}

	// ---------- registration ----------

	/** Register a tool with its command, shortcut, hold binding and toolbar entry. */
	register(tool: ToolContribution): () => void {
		if (tool.when !== undefined) this.contextKeys.validate(tool.when);
		const owner = callerContext(this, this.ctx);
		const command = activateToolCommandId(tool.id);
		const entry: ToolEntry = {
			id: tool.id,
			order: tool.order,
			tool,
			command,
			overlayContent: overlayEntry(tool, owner)
		};
		const disposers = [
			this.registry.register(entry),
			this.commands.register({
				id: command,
				title: `Tool: ${tool.title}`,
				when: tool.when,
				run: () => this.activate(tool.id)
			})
		];
		if (tool.shortcut !== undefined) {
			disposers.push(
				this.keymap.register({
					key: tool.shortcut,
					command,
					scope: tool.scope,
					source: owner.fiber.name
				})
			);
		}
		if (tool.hold !== undefined) {
			disposers.push(
				this.keymap.hold(
					tool.hold,
					() => this.pushTemporary(tool.id),
					() => this.pop(tool.id)
				)
			);
		}
		if (this.activeId() === tool.id) tool.onActivate?.();
		return () => {
			this.detach(entry);
			disposers.reverse().forEach((dispose) => dispose());
		};
	}

	/** A tool leaving while it is in use hands the canvas back to the default tool. */
	private detach(entry: ToolEntry): void {
		const wasActive = this.activeId() === entry.id;
		this.state.temporaryIds = this.state.temporaryIds.filter((id) => id !== entry.id);
		if (this.state.baseId === entry.id && entry.id !== DEFAULT_TOOL_ID) {
			this.state.baseId = DEFAULT_TOOL_ID;
			this.state.locked = false;
		}
		if (!wasActive) return;
		entry.tool.onDeactivate?.();
		this.activeTool()?.onActivate?.();
	}

	// ---------- reads (reactive) ----------

	/** The tools shown on the toolbar, in order. */
	toolbarTools(): readonly ToolEntry[] {
		return this.registry
			.list()
			.filter((entry) => entry.tool.toolbar !== false)
			.filter((entry) => this.contextKeys.evaluate(entry.tool.when));
	}

	/** The tools the toolbar can reach: the visible ones plus members of a dropdown group. */
	toolbarEntries(): readonly ToolEntry[] {
		return this.registry
			.list()
			.filter((entry) => entry.tool.toolbar !== false || entry.tool.toolbarGroup !== undefined)
			.filter((entry) => this.contextKeys.evaluate(entry.tool.when));
	}

	/** The id of the tool in use: the newest temporary tool, else the base tool. */
	activeId(): string {
		const temporary = this.state.temporaryIds.at(-1);
		if (temporary !== undefined) return temporary;
		return this.state.baseId;
	}

	/** The registered entry of the tool in use, if it is registered. */
	get active(): ToolEntry | undefined {
		return this.registry.get(this.activeId());
	}

	get isDefaultActive(): boolean {
		return this.activeId() === DEFAULT_TOOL_ID;
	}

	get locked(): boolean {
		return this.state.locked;
	}

	/** CSS cursor for the canvas while the active tool is in use. */
	get cursor(): string {
		const cursor = this.active?.tool.cursor;
		if (cursor === undefined) return 'default';
		if (typeof cursor === 'string') return cursor;
		return cursor();
	}

	get(id: string): ToolEntry | undefined {
		return this.registry.get(id);
	}

	// ---------- activation ----------

	/** Make `id` the tool in use. `lock` keeps it after its operations finish. */
	activate(id: string, options: { lock?: boolean } = {}): void {
		if (!this.registry.has(id)) throw new UnknownToolError(id);
		const previous = this.activeId();
		this.state.temporaryIds = [];
		this.state.baseId = id;
		this.state.locked = options.lock === true;
		this.switchedFrom(previous);
	}

	/** Back to the default tool. */
	revertToDefault(): void {
		const previous = this.activeId();
		this.state.temporaryIds = [];
		this.state.baseId = DEFAULT_TOOL_ID;
		this.state.locked = false;
		this.switchedFrom(previous);
	}

	/** Use `id` while a key is held; `pop()` restores the previous tool. */
	pushTemporary(id: string): void {
		if (!this.registry.has(id)) throw new UnknownToolError(id);
		const previous = this.activeId();
		this.state.temporaryIds = [...this.state.temporaryIds, id];
		this.switchedFrom(previous);
	}

	/** End the newest temporary tool (or the newest `id`, when given). */
	pop(id?: string): void {
		const stack = this.state.temporaryIds;
		const position = this.temporaryPosition(id);
		if (position < 0) return;
		const previous = this.activeId();
		this.state.temporaryIds = stack.filter((_, index) => index !== position);
		this.switchedFrom(previous);
	}

	private temporaryPosition(id: string | undefined): number {
		const stack = this.state.temporaryIds;
		if (id === undefined) return stack.length - 1;
		return stack.lastIndexOf(id);
	}

	/** A tool finished one operation: back to the default tool unless the tool is locked. */
	completeOperation(): void {
		if (this.state.locked) return;
		if (this.state.temporaryIds.length > 0) return;
		if (this.state.baseId === DEFAULT_TOOL_ID) return;
		this.revertToDefault();
	}

	/**
	 * Esc: the tool aborts its operation first; when it had none, a non-default tool reverts to
	 * the default tool. Returns whether anything was cancelled.
	 */
	cancel(): boolean {
		const tool = this.activeTool();
		if (tool?.onCancel?.() === true) return true;
		if (this.state.temporaryIds.length > 0) return false;
		if (this.state.baseId === DEFAULT_TOOL_ID) return false;
		this.revertToDefault();
		return true;
	}

	// ---------- input (called by the canvas input router) ----------

	pointerDown(event: ToolPointerEvent): void {
		this.activeTool()?.onPointerDown?.(event);
	}

	pointerMove(event: ToolPointerEvent): void {
		this.activeTool()?.onPointerMove?.(event);
	}

	pointerUp(event: ToolPointerEvent): void {
		this.activeTool()?.onPointerUp?.(event);
	}

	pointerLeave(): void {
		this.activeTool()?.onPointerLeave?.();
	}

	keyUp(event: ToolKeyEvent): void {
		this.activeTool()?.onKeyUp?.(event);
	}

	/** Returns whether the active tool used the key. */
	keyDown(event: ToolKeyEvent): boolean {
		return this.activeTool()?.onKey?.(event) === true;
	}

	snapshotState(): unknown {
		return {
			base: this.state.baseId,
			temporary: this.state.temporaryIds,
			locked: this.state.locked
		};
	}

	private activeTool(): ToolContribution | undefined {
		return this.active?.tool;
	}

	private switchedFrom(previousId: string): void {
		const nowId = this.activeId();
		if (previousId === nowId) return;
		this.registry.get(previousId)?.tool.onDeactivate?.();
		this.registry.get(nowId)?.tool.onActivate?.();
		this.ctx.emit('tools/change', nowId, previousId);
	}
}

function overlayEntry(tool: ToolContribution, owner: Context): RegionEntry | undefined {
	const overlay = tool.overlay;
	if (!overlay || !overlay.component) return undefined;
	return {
		id: `tools/${tool.id}/overlay`,
		region: 'canvas-overlay',
		component: overlay.component,
		props: overlay.props,
		ctx: owner
	};
}

/**
 * Publish the active tool as context keys: `activeTool` (its id) and `toolIsDefault`. The
 * registry stores plain values, so a reactive mirror re-publishes on change.
 */
export function publishToolKeys(
	service: ToolsService,
	contextKeys: ContextKeysService
): () => void {
	let unpublish: (() => void)[] = [];
	const stop = $effect.root(() => {
		$effect(() => {
			const id = service.activeId();
			const isDefault = service.isDefaultActive;
			unpublish = untrack(() => [
				contextKeys.set('activeTool', id),
				contextKeys.set('toolIsDefault', isDefault)
			]);
			return () => unpublish.forEach((dispose) => dispose());
		});
	});
	return () => {
		stop();
		unpublish.forEach((dispose) => dispose());
	};
}
