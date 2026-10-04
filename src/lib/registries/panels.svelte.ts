// Panels: the sidebars host tabs (left: File / Assets, right: Design / Prototype / Inspect) and
// a tab hosts stacked sections. Plugins only call the panels service:
//
//   ctx.effect(
//   	() => ctx.panels.registerTab({ id: 'assets', side: 'left', title: 'Assets', shortcut: 'Alt+2', component: AssetsTab }),
//   	'assets tab'
//   );
//   ctx.effect(
//   	() => ctx.panels.registerSection({ tab: 'design', id: 'fill', title: 'Fill', order: 30, component: FillSection }),
//   	'fill section'
//   );
//
// `registerTab` registers three things and one disposer removes all three: the tab, the command
// `panels.show.<id>` that activates it, and the key binding for `shortcut`. A tab renders its own
// `component` (if any) followed by its stacked sections. `when` is a context-key expression, so
// the mode (`mode == design`, `mode == dev`) and anything else plugins publish decides what shows.
//
// Which tab is active per side, and which sections are collapsed, is `PanelState`; it persists
// to a storage (localStorage by default) and later to the settings service. The sidebar chrome
// itself (widths, collapsed sidebars) belongs to workbench-layout, which listens to
// `panels/tab-activated` to reveal a collapsed sidebar.

import { Service, type Context } from '@neoworks/extension-system';
import { untrack, type Component } from 'svelte';
import { callerContext } from '../kernel/caller';
import type { CommandsService } from './commands.svelte';
import type { ContextKeysService } from './contextKeys.svelte';
import type { KeymapService } from './keymap.svelte';
import { Registry, type RegistryEntry } from './registry.svelte';
import type { RegionEntry } from './regions.svelte';

export type PanelSide = 'left' | 'right';
export type PanelMode = 'design' | 'dev';

// Contributed components have arbitrary props, see RegionContribution.
// oxlint-disable-next-line typescript/no-explicit-any
type AnyComponent = Component<any>;

export interface PanelTabContribution {
	id: string;
	side: PanelSide;
	title: string;
	icon?: AnyComponent;
	order?: number;
	/** Context-key expression; the tab is hidden while false. */
	when?: string;
	/** The tab's own content, rendered above its sections. */
	component?: AnyComponent;
	props?: Record<string, unknown>;
	/** Chord that activates the tab, for example `Alt+1`. */
	shortcut?: string;
}

export interface PanelSectionContribution {
	/** Id of the tab the section stacks in. */
	tab: string;
	id: string;
	title: string;
	order?: number;
	/** Context-key expression; the section is hidden while false. */
	when?: string;
	component: AnyComponent;
	props?: Record<string, unknown>;
	/** Start collapsed until the user chooses otherwise. */
	collapsed?: boolean;
}

export interface PanelTab extends RegistryEntry {
	side: PanelSide;
	title: string;
	icon?: AnyComponent;
	when?: string;
	command: string;
	/** Renders `component` with the owning plugin's ctx; absent for a sections-only tab. */
	content?: RegionEntry;
}

export interface PanelSection extends RegistryEntry {
	tab: string;
	title: string;
	when?: string;
	collapsedByDefault: boolean;
	content: RegionEntry;
}

export interface PanelStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const PANEL_STORAGE_KEY = 'panels/state';

interface PersistedPanels {
	activeTabs: Partial<Record<PanelSide, string>>;
	/** Section ids the user changed, true = collapsed. Absent ids follow the default. */
	sectionStates: Record<string, boolean>;
}

function parsePersisted(raw: string | null): Partial<PersistedPanels> {
	if (raw === null) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return {};
		return parsed;
	} catch {
		return {};
	}
}

function readActiveTabs(value: unknown): Partial<Record<PanelSide, string>> {
	if (typeof value !== 'object' || value === null) return {};
	const tabs: Partial<Record<PanelSide, string>> = {};
	const left: unknown = Reflect.get(value, 'left');
	const right: unknown = Reflect.get(value, 'right');
	if (typeof left === 'string') tabs.left = left;
	if (typeof right === 'string') tabs.right = right;
	return tabs;
}

function readSectionStates(value: unknown): Record<string, boolean> {
	if (typeof value !== 'object' || value === null) return {};
	const states: Record<string, boolean> = {};
	for (const [id, state] of Object.entries(value)) {
		if (typeof state === 'boolean') states[id] = state;
	}
	return states;
}

/** Reactive panel state. Not a Service, so runes are fine; the service exposes it as a field. */
export class PanelState {
	activeTabs = $state.raw<Partial<Record<PanelSide, string>>>({});
	sectionStates = $state.raw<Record<string, boolean>>({});
	/** Dev Mode swaps the Design/Prototype tabs for Inspect (Shift+D). Not persisted. */
	mode = $state<PanelMode>('design');

	constructor(storage?: PanelStorage) {
		if (!storage) return;
		const saved = parsePersisted(storage.getItem(PANEL_STORAGE_KEY));
		this.activeTabs = readActiveTabs(saved.activeTabs);
		this.sectionStates = readSectionStates(saved.sectionStates);
	}

	setActiveTab(side: PanelSide, id: string): void {
		this.activeTabs = { ...this.activeTabs, [side]: id };
	}

	setSectionCollapsed(id: string, collapsed: boolean): void {
		this.sectionStates = { ...this.sectionStates, [id]: collapsed };
	}

	serialize(): string {
		const persisted: PersistedPanels = {
			activeTabs: this.activeTabs,
			sectionStates: this.sectionStates
		};
		return JSON.stringify(persisted);
	}
}

/**
 * Write the panel state to `storage` whenever it changes. Returns the stop function; meant to
 * run inside `ctx.effect`.
 */
export function persistPanelState(state: PanelState, storage: PanelStorage): () => void {
	return $effect.root(() => {
		$effect(() => {
			storage.setItem(PANEL_STORAGE_KEY, state.serialize());
		});
	});
}

/**
 * Publish `state.mode` as the context key `mode`. The key is a registry entry with a plain
 * value, so a reactive mirror re-publishes it on change. Returns the stop function.
 */
export function publishModeKey(state: PanelState, contextKeys: ContextKeysService): () => void {
	let unpublish: (() => void) | undefined;
	const stop = $effect.root(() => {
		$effect(() => {
			const mode = state.mode;
			// `set` reads the registry it writes: untracked, or the effect would depend on itself.
			const dispose = untrack(() => contextKeys.set('mode', mode));
			unpublish = dispose;
			return dispose;
		});
	});
	return () => {
		stop();
		unpublish?.();
	};
}

class WhenRegistry<T extends RegistryEntry & { when?: string }> extends Registry<T> {
	constructor(private readonly contextKeys: ContextKeysService) {
		super();
	}

	protected override isActive(entry: T): boolean {
		return this.contextKeys.evaluate(entry.when);
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		panels: PanelsService;
	}
}

export function showTabCommandId(tabId: string): string {
	return `panels.show.${tabId}`;
}

export class PanelsService extends Service {
	readonly tabRegistry: WhenRegistry<PanelTab>;
	readonly sectionRegistry: WhenRegistry<PanelSection>;
	readonly state: PanelState;

	/** Dependencies are captured from the providing plugin's ctx (see CommandsService). */
	constructor(
		ctx: Context,
		private readonly commands: CommandsService,
		private readonly keymap: KeymapService,
		private readonly contextKeys: ContextKeysService,
		state: PanelState
	) {
		super(ctx, 'panels');
		this.tabRegistry = new WhenRegistry<PanelTab>(contextKeys);
		this.sectionRegistry = new WhenRegistry<PanelSection>(contextKeys);
		this.state = state;
	}

	/**
	 * Add a tab to a sidebar together with its `panels.show.<id>` command and, when `shortcut`
	 * is given, the key binding. The disposer removes all three.
	 */
	registerTab(tab: PanelTabContribution): () => void {
		if (tab.when !== undefined) this.contextKeys.validate(tab.when);
		const owner = callerContext(this, this.ctx);
		const command = showTabCommandId(tab.id);
		const entry: PanelTab = {
			id: tab.id,
			order: tab.order,
			side: tab.side,
			title: tab.title,
			icon: tab.icon,
			when: tab.when,
			command,
			content: contentEntry(tab.id, tab.side, tab.component, tab.props, owner)
		};
		const disposers = [
			this.tabRegistry.register(entry),
			this.commands.register({
				id: command,
				title: `Show ${tab.title}`,
				run: () => this.activateTab(tab.id)
			})
		];
		if (tab.shortcut !== undefined) {
			disposers.push(
				this.keymap.register({ key: tab.shortcut, command, source: owner.fiber.name })
			);
		}
		return () => disposers.reverse().forEach((dispose) => dispose());
	}

	/** Stack a section in a tab. Sections sort by `order` and hide with `when`. */
	registerSection(section: PanelSectionContribution): () => void {
		if (section.when !== undefined) this.contextKeys.validate(section.when);
		const owner = callerContext(this, this.ctx);
		const id = `${section.tab}/${section.id}`;
		const content = contentEntry(id, section.tab, section.component, section.props, owner);
		if (!content) throw new Error(`section "${id}" needs a component`);
		return this.sectionRegistry.register({
			id,
			order: section.order,
			tab: section.tab,
			title: section.title,
			when: section.when,
			collapsedByDefault: section.collapsed === true,
			content
		});
	}

	/** Reactive: the visible tabs of a sidebar, ordered. */
	tabs(side: PanelSide): readonly PanelTab[] {
		return this.tabRegistry.list().filter((tab) => tab.side === side);
	}

	getTab(id: string): PanelTab | undefined {
		return this.tabRegistry.get(id);
	}

	/** Reactive: the visible sections of a tab, ordered. */
	sections(tabId: string): readonly PanelSection[] {
		return this.sectionRegistry.list().filter((section) => section.tab === tabId);
	}

	/** Reactive: the active tab of a side: the chosen one if visible, else the first visible. */
	activeTab(side: PanelSide): PanelTab | undefined {
		const visible = this.tabs(side);
		const chosen = this.state.activeTabs[side];
		const active = visible.find((tab) => tab.id === chosen);
		if (active) return active;
		return visible[0];
	}

	/** Make a tab the active one of its sidebar and tell the layout to reveal that sidebar. */
	activateTab(id: string): void {
		const tab = this.tabRegistry.get(id);
		if (!tab) return;
		this.state.setActiveTab(tab.side, id);
		this.ctx.emit('panels/tab-activated', tab.side, id);
	}

	/** Reactive. */
	isSectionCollapsed(section: PanelSection): boolean {
		const chosen = this.state.sectionStates[section.id];
		if (chosen === undefined) return section.collapsedByDefault;
		return chosen;
	}

	toggleSection(section: PanelSection): void {
		this.state.setSectionCollapsed(section.id, !this.isSectionCollapsed(section));
	}

	get mode(): PanelMode {
		return this.state.mode;
	}

	setMode(mode: PanelMode): void {
		this.state.mode = mode;
	}

	snapshotState(): unknown {
		return { activeTabs: this.state.activeTabs, mode: this.state.mode };
	}
}

function contentEntry(
	id: string,
	region: string,
	component: AnyComponent | undefined,
	props: Record<string, unknown> | undefined,
	ctx: Context
): RegionEntry | undefined {
	if (!component) return undefined;
	return { id: `panels/${id}`, region, component, props, ctx };
}
