import { Service, type Context } from '@neoworks/extension-system';
import { Registry, type RegistryEntry } from '../../lib/registries/registry.svelte';
import { rank, type FuzzyMatch } from './fuzzy';
import type { PaletteState } from './state.svelte';

export interface PaletteItem {
	/** Unique within its source. */
	id: string;
	title: string;
	subtitle?: string;
	accelerator?: string;
	/** Shown dimmed and not runnable while false. */
	enabled?: boolean;
	run: () => void | Promise<void>;
	/** Set on commands: remembered as the last command when run. */
	commandId?: string;
}

export interface PaletteSource {
	id: string;
	/** Tab label. */
	title: string;
	order?: number;
	placeholder?: string;
	/** Candidates for `query`; the palette ranks them by fuzzy match on the title. Reactive reads are fine. */
	items: (query: string) => PaletteItem[];
	/**
	 * The items are already filtered and ordered for the query (a semantic search): the palette
	 * keeps them as they are instead of matching the title against the query letter by letter.
	 */
	ranked?: boolean;
	/**
	 * An extra row for a non-empty query, shown after the matches (for example "Ask the AI").
	 * This is the reserved hook for a natural-language mode.
	 */
	fallback?: (query: string) => PaletteItem | undefined;
}

export interface PaletteSourceEntry extends RegistryEntry {
	source: PaletteSource;
}

export interface PaletteRow {
	item: PaletteItem;
	match: FuzzyMatch;
}

const MAX_RECENT = 5;
const MAX_ROWS = 100;
export const COMMANDS_SOURCE_ID = 'commands';

declare module '@neoworks/extension-system' {
	interface Context {
		palette: PaletteService;
	}
}

export class PaletteService extends Service {
	readonly sources = new Registry<PaletteSourceEntry>();

	constructor(
		ctx: Context,
		readonly state: PaletteState
	) {
		super(ctx, 'palette');
	}

	/** Add a source (a tab of the palette). Replaces the same id; dispose by identity. */
	registerSource(source: PaletteSource): () => void {
		return this.sources.register({ id: source.id, order: source.order, source });
	}

	/** Reactive: the sources in tab order. */
	sourceList(): PaletteSource[] {
		return this.sources.list().map((entry) => entry.source);
	}

	get isOpen(): boolean {
		return this.state.open;
	}

	get query(): string {
		return this.state.query;
	}

	get sourceId(): string {
		return this.state.sourceId;
	}

	get index(): number {
		return this.state.index;
	}

	/** Open on `sourceId` (the commands by default) with an empty query. */
	open(sourceId: string = COMMANDS_SOURCE_ID): void {
		this.state.sourceId = sourceId;
		this.state.query = '';
		this.state.index = 0;
		this.state.open = true;
	}

	close(): void {
		this.state.open = false;
	}

	toggle(): void {
		if (this.state.open) this.close();
		else this.open();
	}

	setQuery(query: string): void {
		this.state.query = query;
		this.state.index = 0;
	}

	setSource(sourceId: string): void {
		this.state.sourceId = sourceId;
		this.state.index = 0;
	}

	/** Tab: the next (or previous) source, wrapping around. */
	cycleSource(step: 1 | -1): void {
		const sources = this.sourceList();
		if (sources.length === 0) return;
		const current = sources.findIndex((source) => source.id === this.state.sourceId);
		const next = (current + step + sources.length) % sources.length;
		this.setSource(sources[next].id);
	}

	highlight(index: number): void {
		this.state.index = index;
	}

	/** Arrow keys: move the highlight, wrapping around. */
	move(step: number): void {
		const count = this.rows().length;
		if (count === 0) return;
		this.state.index = (this.state.index + step + count) % count;
	}

	/** Reactive: the matches of the current query in the current source, best first. */
	rows(): PaletteRow[] {
		const entry = this.sources.get(this.state.sourceId);
		if (!entry) return [];
		const { source } = entry;
		const query = this.state.query;
		const ranked = this.rowsOf(source, query);
		const fallback = this.fallbackRow(source, query);
		if (fallback) ranked.push(fallback);
		return ranked;
	}

	/** Run the highlighted row and close. */
	async runSelected(): Promise<void> {
		const row = this.rows()[this.state.index];
		if (!row) return;
		await this.run(row.item);
	}

	async run(item: PaletteItem): Promise<void> {
		if (item.enabled === false) return;
		this.close();
		if (item.commandId !== undefined) this.remember(item.commandId);
		await item.run();
	}

	/** Reactive: ids of the commands run through the palette, newest first. */
	recentCommands(): readonly string[] {
		return this.state.recent;
	}

	snapshotState(): unknown {
		return { open: this.state.open, recent: this.state.recent.length };
	}

	private remember(commandId: string): void {
		const others = this.state.recent.filter((id) => id !== commandId);
		this.state.recent = [commandId, ...others].slice(0, MAX_RECENT);
	}

	private rowsOf(source: PaletteSource, query: string): PaletteRow[] {
		if (source.ranked === true) {
			return source
				.items(query)
				.slice(0, MAX_ROWS)
				.map((item) => ({ item, match: { score: 0, indices: [] } }));
		}
		return rank(source.items(query), query, (item) => item.title)
			.slice(0, MAX_ROWS)
			.map(({ item, match }) => ({ item, match }));
	}

	private fallbackRow(source: PaletteSource, query: string): PaletteRow | undefined {
		if (query.trim() === '' || !source.fallback) return undefined;
		const item = source.fallback(query);
		if (!item) return undefined;
		return { item, match: { score: 0, indices: [] } };
	}
}
