import { Service, type Context } from '@neoworks/extension-system';
import { untrack } from 'svelte';
import type { MenuPoint, MenusService } from '../../lib/registries/menus.svelte';
import type { ToolEntry, ToolsService } from '../../lib/registries/tools.svelte';
import { buildSlots, groupMenuPath, shownEntry, type ToolbarSlot } from './slots';

/** Which member of each dropdown group was used last. Not a Service, so runes are fine. */
export class ToolbarState {
	lastUsed = $state.raw<Readonly<Record<string, string>>>({});
}

/** Menu path whose submenu items appear on the toolbar as icon buttons with a dropdown. */
export const TOOLBAR_MENU = 'toolbar';

declare module '@neoworks/extension-system' {
	interface Context {
		toolbar: ToolbarService;
	}
}

export class ToolbarService extends Service {
	constructor(
		ctx: Context,
		private readonly tools: ToolsService,
		private readonly menus: MenusService,
		private readonly state: ToolbarState
	) {
		super(ctx, 'toolbar');
	}

	/** Reactive: the buttons of the tool section, in order. */
	slots(): ToolbarSlot[] {
		return buildSlots(this.tools.toolbarEntries());
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
