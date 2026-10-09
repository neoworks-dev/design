import { Service, type Context } from '@neoworks/extension-system';
import { untrack } from 'svelte';
import type { Component } from 'svelte';
import type { CommandsService } from '../../lib/registries/commands.svelte';
import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';
import type { MenuPoint, MenusService } from '../../lib/registries/menus.svelte';
import { Registry, type RegistryEntry } from '../../lib/registries/registry.svelte';
import type { ToolEntry, ToolsService } from '../../lib/registries/tools.svelte';
import { buildSlots, groupMenuPath, shownEntry, type ToolbarSlot } from './slots';

/** Which member of each dropdown group was used last. Not a Service, so runes are fine. */
export class ToolbarState {
	lastUsed = $state.raw<Readonly<Record<string, string>>>({});
}

/** Menu path whose submenu items appear on the toolbar as icon buttons with a dropdown. */
export const TOOLBAR_MENU = 'toolbar';

/** The mode a tool belongs to when it does not say (and the mode shown when none is active). */
export const DEFAULT_MODE_ID = 'design';

/** A workspace mode on the right of the toolbar (Design, Dev). Contributed through `registerMode`. */
export interface ToolbarMode extends RegistryEntry {
	title: string;
	// phosphor-svelte icons accept more props than `size` and `weight`
	// oxlint-disable-next-line typescript/no-explicit-any
	icon: Component<any>;
	/** Command that switches to the mode. */
	command: string;
	/** Context-key expression that is true while the mode is the current one. */
	active: string;
	/** Colour of the active tool and the active mode button. Defaults to blue. */
	accent?: 'blue' | 'green';
}

declare module '@neoworks/extension-system' {
	interface Context {
		toolbar: ToolbarService;
	}
}

export class ToolbarService extends Service {
	readonly modeRegistry = new Registry<ToolbarMode>();

	constructor(
		ctx: Context,
		private readonly contextKeys: ContextKeysService,
		private readonly commands: CommandsService,
		private readonly tools: ToolsService,
		private readonly menus: MenusService,
		private readonly state: ToolbarState
	) {
		super(ctx, 'toolbar');
	}

	/** Add a mode button. The disposer removes it. */
	registerMode(mode: ToolbarMode): () => void {
		return this.modeRegistry.register(mode);
	}

	/** Reactive: the registered modes, in order. */
	modes(): readonly ToolbarMode[] {
		return this.modeRegistry.list();
	}

	/** Reactive: the mode that is active now, if any mode is registered. */
	currentMode(): ToolbarMode | undefined {
		return this.modes().find((mode) => this.contextKeys.evaluate(mode.active));
	}

	/** Reactive: the id of the current mode, `design` while no mode plugin is loaded. */
	currentModeId(): string {
		const mode = this.currentMode();
		if (mode === undefined) return DEFAULT_MODE_ID;
		return mode.id;
	}

	switchMode(mode: ToolbarMode): Promise<unknown> {
		return this.commands.run(mode.command);
	}

	/** Reactive: the buttons of the tool section in the current mode, in order. */
	slots(): ToolbarSlot[] {
		const modeId = this.currentModeId();
		return buildSlots(this.tools.toolbarEntries().filter((entry) => inMode(entry, modeId)));
	}

	/** Reactive: the member whose icon the slot shows. */
	shown(slot: ToolbarSlot): ToolEntry {
		const lastUsed = slot.group === undefined ? undefined : this.state.lastUsed[slot.group];
		return shownEntry(slot, this.tools.activeId(), lastUsed);
	}

	/** Remember a used tool as its group's representative. */
	remember(toolId: string): void {
		const group = this.tools.get(toolId)?.tool.toolbarGroup;
		if (group === undefined) return;
		this.state.lastUsed = { ...this.state.lastUsed, [group]: toolId };
	}

	/** Open the dropdown of a tool group above `point`. */
	openGroupMenu(group: string, point: MenuPoint): void {
		this.menus.openMenu(groupMenuPath(group), point, 'above');
	}

	/** Open a menu contributed through the `toolbar` menu above `point`. */
	openMenu(path: string, point: MenuPoint): void {
		this.menus.openMenu(path, point, 'above');
	}

	snapshotState(): unknown {
		return { lastUsed: this.state.lastUsed };
	}
}

function inMode(entry: ToolEntry, modeId: string): boolean {
	const modes = entry.tool.modes;
	if (modes === undefined) return modeId === DEFAULT_MODE_ID;
	return modes.includes(modeId);
}

/**
 * Keep the dropdown menu of every tool group in the `menus` registry in step with the tools
 * registry: one item per member, checked while that tool is active.
 */
export function publishGroupMenus(tools: ToolsService, menus: MenusService): () => void {
	let unregister: (() => void)[] = [];
	const stop = $effect.root(() => {
		$effect(() => {
			const entries = tools.toolbarEntries().filter((entry) => entry.tool.toolbarGroup);
			unregister = untrack(() => entries.map((entry) => registerGroupItem(menus, entry)));
			return () => unregister.forEach((dispose) => dispose());
		});
	});
	return () => {
		stop();
		unregister.forEach((dispose) => dispose());
	};
}

function registerGroupItem(menus: MenusService, entry: ToolEntry): () => void {
	return menus.register({
		menu: groupMenuPath(entry.tool.toolbarGroup ?? ''),
		item: {
			id: entry.id,
			command: entry.command,
			title: entry.tool.title,
			icon: entry.tool.icon,
			order: entry.tool.order,
			toggled: `activeTool == '${entry.id}'`
		}
	});
}
