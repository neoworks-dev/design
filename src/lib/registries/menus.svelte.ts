// Menus: one registry for the app menu, toolbar dropdowns and context menus. A menu is a path
// (`app/file`, `context/canvas`) and its items are contributions from any plugin.
//
// Provided by plugin `core-menus` as `ctx.menus`:
//
//   ctx.effect(
//   	() => ctx.menus.register({ menu: 'context/layer', item: { id: 'rename', command: 'layers.rename', group: '1_edit' } }),
//   	'layer rename menu item'
//   );
//   ctx.menus.resolve('context/layer');              // visible items with accelerators
//   ctx.menus.open('layer', { x: 10, y: 20 }, node); // the popup host opens `context/layer`
//
// Context menus are keyed by target kind: kind `layer` is the menu `context/layer`, so each kind
// resolves independently. Items are ordered by `group` (text, ascending) and then `order`;
// a separator is derived wherever the group changes between two visible items.

import { Service, type Context } from '@neoworks/extension-system';
import type { Component } from 'svelte';
import type { CommandsService } from './commands.svelte';
import type { ContextKeysService } from './contextKeys.svelte';
import type { KeymapService } from './keymap.svelte';
import { Registry, type RegistryEntry } from './registry.svelte';
import { evaluateWhenExpression } from './whenExpression';

export type MenuTargetKind =
	| 'canvas'
	| 'canvas-empty'
	| 'layer'
	| 'layer-panel'
	| 'asset'
	| 'page'
	| 'text-edit'
	| (string & {});

export interface MenuItemContribution {
	/** Unique within its menu. */
	id: string;
	/** Command to run on activation; the title and accelerator derive from it. */
	command?: string;
	/** Label; defaults to the command's title. Needed for submenu items without a command. */
	title?: string;
	/** Passed to the command; popups default to the target of `open`. */
	args?: unknown;
	/** Separators appear where the group changes. Items without a group sort first. */
	group?: string;
	order?: number;
	/** Context-key expression; the item is hidden while false. */
	when?: string;
	/** Context-key expression; the item shows a check mark while true. */
	toggled?: string;
	/** Path of another menu whose items form this item's submenu. */
	submenu?: string;
	/** Shown by menus that render icons (the toolbar). */
	icon?: MenuIcon;
}

// phosphor-svelte icons accept more props than `size` and `weight`
// oxlint-disable-next-line typescript/no-explicit-any
export type MenuIcon = Component<any>;

export interface MenuRegistration {
	/** Menu path, for example `app/file` or `context/canvas`. */
	menu: string;
	item: MenuItemContribution;
}

export interface MenuEntry extends RegistryEntry, MenuItemContribution {
	menu: string;
}

export interface ResolvedMenuItem {
	id: string;
	title: string;
	command?: string;
	args?: unknown;
	icon?: MenuIcon;
	accelerator?: string;
	enabled: boolean;
	checked: boolean;
	/** True when the previous visible item belongs to another group. */
	separatorBefore: boolean;
	/** Present for submenu items; never empty (a submenu without visible items is hidden). */
	submenu?: ResolvedMenuItem[];
	/** Menu path of the submenu, for hosts that open it as a popup of its own. */
	submenuPath?: string;
}

export interface MenuPoint {
	x: number;
	y: number;
}

export interface MenuPopup {
	kind: MenuTargetKind;
	menu: string;
	point: MenuPoint;
	/** `above` grows upwards from the point (menus opened from a bottom toolbar). */
	placement: 'below' | 'above';
	target: unknown;
}

/** Facts about the menu's target, layered over the global context keys while resolving. */
export type MenuContextKeys = Record<string, unknown>;

const MAX_SUBMENU_DEPTH = 8;

/** The open popup. Not a Service, so runes are fine; the service exposes it as a field. */
export class MenuPopupState {
	current = $state.raw<MenuPopup | null>(null);
}

declare module '@neoworks/extension-system' {
	interface Context {
		menus: MenusService;
	}
}

export function contextMenuPath(kind: MenuTargetKind): string {
	return `context/${kind}`;
}

export class MenusService extends Service {
	readonly registry = new Registry<MenuEntry>();
	readonly popupState = new MenuPopupState();

	/** Dependencies are captured from the providing plugin's ctx (see CommandsService). */
	constructor(
		ctx: Context,
		private readonly commands: CommandsService,
		private readonly keymap: KeymapService,
		private readonly contextKeys: ContextKeysService
	) {
		super(ctx, 'menus');
	}

	/** Add an item to a menu. Replaces the same id in the same menu; dispose by identity. */
	register(registration: MenuRegistration): () => void {
		const { menu, item } = registration;
		if (item.when !== undefined) this.contextKeys.validate(item.when);
		if (item.toggled !== undefined) this.contextKeys.validate(item.toggled);
		if (item.command === undefined && item.submenu === undefined) {
			throw new Error(`menu item "${menu}/${item.id}" needs a command or a submenu`);
		}
		return this.registry.register({ ...item, id: `${menu}|${item.id}`, menu });
	}

	/** Reactive: whether a menu has any registered item, visible or not. */
	has(menu: string): boolean {
		return this.registry.listAll().some((entry) => entry.menu === menu);
	}

	/**
	 * Reactive: the visible items of `menu` with enabled state and accelerators resolved. `keys`
	 * layers facts about the target over the global context keys while `when` is evaluated.
	 */
	resolve(menu: string, keys: MenuContextKeys = {}): ResolvedMenuItem[] {
		return this.resolveLevel(menu, keys, 0);
	}

	/** Reactive: the open popup, or null. */
	get popup(): MenuPopup | null {
		return this.popupState.current;
	}

	/** Open the context menu of `kind` at a client-space point. Replaces an open popup. */
	open(kind: MenuTargetKind, point: MenuPoint, target?: unknown): void {
		this.popupState.current = {
			kind,
			menu: contextMenuPath(kind),
			point,
			placement: 'below',
			target
		};
	}

	/** Open any menu path (a toolbar dropdown) at a client-space point. Replaces an open popup. */
	openMenu(menu: string, point: MenuPoint, placement: MenuPopup['placement'] = 'below'): void {
		this.popupState.current = { kind: menu, menu, point, placement, target: undefined };
	}

	/** Open from a `contextmenu` DOM event: suppresses the native menu. */
	openFromEvent(kind: MenuTargetKind, event: MouseEvent, target?: unknown): void {
		event.preventDefault();
		this.open(kind, { x: event.clientX, y: event.clientY }, target);
	}

	close(): void {
		this.popupState.current = null;
	}

	/** Run an item's command (args default to the popup target) and close the popup. */
	async activate(item: ResolvedMenuItem): Promise<void> {
		if (!item.enabled || item.command === undefined) return;
		const args = this.argsFor(item);
		this.close();
		await this.commands.run(item.command, args);
	}

	snapshotState(): unknown {
		return { popup: this.popupState.current?.menu };
	}

	private argsFor(item: ResolvedMenuItem): unknown {
		if (item.args !== undefined) return item.args;
		return this.popupState.current?.target;
	}

	private resolveLevel(menu: string, keys: MenuContextKeys, depth: number): ResolvedMenuItem[] {
		const entries = this.registry
			.list()
			.filter((entry) => entry.menu === menu)
			.filter((entry) => this.isVisible(entry, keys));
		const items: ResolvedMenuItem[] = [];
		let previousGroup: string | undefined;
		for (const entry of orderByGroup(entries)) {
			const item = this.resolveItem(entry, keys, depth);
			if (!item) continue;
			item.separatorBefore = previousGroup !== undefined && previousGroup !== groupOf(entry);
			previousGroup = groupOf(entry);
			items.push(item);
		}
		return items;
	}

	private resolveItem(
		entry: MenuEntry,
		keys: MenuContextKeys,
		depth: number
	): ResolvedMenuItem | undefined {
		const submenu = this.resolveSubmenu(entry, keys, depth);
		if (entry.submenu !== undefined && submenu === undefined) return undefined;
		return {
			id: entry.id.slice(entry.menu.length + 1),
			title: this.titleOf(entry),
			command: entry.command,
			args: entry.args,
			icon: entry.icon,
			accelerator: this.acceleratorOf(entry),
			enabled: this.isEnabled(entry),
			checked: entry.toggled !== undefined && this.evaluate(entry.toggled, keys),
			separatorBefore: false,
			submenu,
			submenuPath: entry.submenu
		};
	}

	private resolveSubmenu(
		entry: MenuEntry,
		keys: MenuContextKeys,
		depth: number
	): ResolvedMenuItem[] | undefined {
		if (entry.submenu === undefined || depth >= MAX_SUBMENU_DEPTH) return undefined;
		const children = this.resolveLevel(entry.submenu, keys, depth + 1);
		if (children.length === 0) return undefined;
		return children;
	}

	private isVisible(entry: MenuEntry, keys: MenuContextKeys): boolean {
		if (entry.when === undefined) return true;
		return this.evaluate(entry.when, keys);
	}

	private isEnabled(entry: MenuEntry): boolean {
		if (entry.command === undefined) return true;
		return this.commands.isEnabled(entry.command);
	}

	private titleOf(entry: MenuEntry): string {
		if (entry.title !== undefined) return entry.title;
		if (entry.command === undefined) return entry.id;
		const command = this.commands.get(entry.command);
		if (command) return command.title;
		return entry.command;
	}

	private acceleratorOf(entry: MenuEntry): string | undefined {
		if (entry.command === undefined) return undefined;
		return this.keymap.lookup(entry.command);
	}

	private evaluate(expression: string, keys: MenuContextKeys): boolean {
		return evaluateWhenExpression(expression, (name) => {
			if (Object.hasOwn(keys, name)) return keys[name];
			return this.contextKeys.get(name);
		});
	}
}

function groupOf(entry: MenuEntry): string {
	if (entry.group === undefined) return '';
	return entry.group;
}

function orderByGroup(entries: readonly MenuEntry[]): MenuEntry[] {
	const indexed = entries.map((entry, index) => ({ entry, index }));
	indexed.sort((a, b) => {
		const byGroup = groupOf(a.entry).localeCompare(groupOf(b.entry));
		if (byGroup !== 0) return byGroup;
		return a.index - b.index;
	});
	return indexed.map((item) => item.entry);
}
