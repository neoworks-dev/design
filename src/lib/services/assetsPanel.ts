// The `assetsPanel` service (#79): the local library of the open file. Components (grouped by
// slash path or variant set), paint / text / effect / grid styles and media, filtered by one
// search query, with the actions of their context menus and insertion of instances. Reads are
// reactive through `componentSync`, `styles` and `document`; every write goes through
// `document.apply` and ends as one undo step.

import { Service, type Context } from '@neoworks/extension-system';
import {
	ComponentCycleError,
	type AssetRecord,
	type NodeId,
	type Style,
	type StyleTarget,
	type StyleType
} from '../document';
import { insertionParent, planInstanceAt, type Point } from '../assets/insert';
import { applyEdit } from '../editing/contribute';
import { groupPathOf, leafNameOf } from '../variables/organize';
import type { ComponentSummary } from './componentSync';
import type { AssetsPanelState } from './assetsPanelState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		assetsPanel: AssetsPanelService;
	}
}

export interface ComponentEntry {
	id: NodeId;
	/** The full name, as searched. */
	name: string;
	/** The last path segment (a variant keeps its whole name). */
	label: string;
	/** Group heading: slash path, or the variant set's name; empty at the top. */
	group: string;
	description: string;
	/** Inserting it where the selection is would put it inside itself. */
	blocked: boolean;
}

export interface ComponentGroup {
	group: string;
	entries: ComponentEntry[];
}

export interface StyleGroup {
	type: StyleType;
	title: string;
	styles: Style[];
}

const STYLE_SECTIONS: Array<{ type: StyleType; title: string }> = [
	{ type: 'PAINT', title: 'Color styles' },
	{ type: 'TEXT', title: 'Text styles' },
	{ type: 'EFFECT', title: 'Effect styles' },
	{ type: 'GRID', title: 'Grid styles' }
];

const STYLE_TARGET_OF: Record<StyleType, StyleTarget> = {
	PAINT: 'fill',
	TEXT: 'text',
	EFFECT: 'effect',
	GRID: 'grid'
};

export class AssetsPanelService extends Service {
	constructor(
		ctx: Context,
		private readonly state: AssetsPanelState
	) {
		super(ctx, 'assetsPanel');
	}

	// ---------- search and view state ----------

	get query(): string {
		return this.state.query;
	}

	get notice(): string {
		return this.state.notice;
	}

	get renamingStyleId(): string | null {
		return this.state.renamingStyleId;
	}

	setQuery(query: string): void {
		this.state.query = query;
	}

	isCollapsed(key: string): boolean {
		return this.state.collapsed.includes(key);
	}

	toggleCollapsed(key: string): void {
		if (this.state.collapsed.includes(key)) {
			this.state.collapsed = this.state.collapsed.filter((entry) => entry !== key);
			return;
		}
		this.state.collapsed = [...this.state.collapsed, key];
	}

	dismissNotice(): void {
		this.state.notice = '';
	}

	// ---------- reads (reactive) ----------

	/** Components matching the search, grouped; groups and entries keep document order. */
	componentGroups(): ComponentGroup[] {
		const needle = this.state.query.trim().toLowerCase();
		const entries = this.ctx.componentSync
			.components()
			.map((summary) => this.entryOf(summary))
			.filter((entry) => matches(entry, needle));
		return groupEntries(entries);
	}

	/** Styles per type, filtered by the search; empty sections are left out. */
	styleSections(): StyleGroup[] {
		const needle = this.state.query.trim().toLowerCase();
		const sections: StyleGroup[] = [];
		for (const section of STYLE_SECTIONS) {
			const styles = this.ctx.styles
				.list(section.type)
				.filter((style) => style.name.toLowerCase().includes(needle));
			if (styles.length > 0) sections.push({ ...section, styles });
		}
		return sections;
	}

	media(): AssetRecord[] {
		return this.ctx.document.entities('asset');
	}

	/** Whether inserting `mainId` at the default place would put a component inside itself. */
	isBlocked(mainId: NodeId): boolean {
		const parentId = this.defaultParent();
		if (parentId === this.ctx.document.currentPageId) return false;
		if (parentId === mainId) return true;
		return this.ctx.document.ancestors(parentId).some((ancestor) => ancestor.id === mainId);
	}

	// ---------- insert ----------

	/** Insert an instance centred on a page point, inside the frame under it. Returns the id. */
	insertAt(mainId: NodeId, world: Point, hitId?: NodeId): NodeId | undefined {
		const reader = this.ctx.document.reader;
		const parentId = insertionParent(reader, hitId, this.ctx.document.currentPageId);
		return this.insertInto(mainId, parentId, world);
	}

	/** Insert at the middle of the selected frame, else of what the canvas shows. */
	insertAtDefault(mainId: NodeId): NodeId | undefined {
		const parentId = this.defaultParent();
		const reader = this.ctx.document.reader;
		let world = this.viewportCentre();
		if (parentId !== this.ctx.document.currentPageId) {
			const bounds = reader.cache.absoluteBounds(parentId);
			world = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		}
		return this.insertInto(mainId, parentId, world);
	}

	// ---------- actions of the context menus ----------

	goToMain(mainId: NodeId): void {
		const document = this.ctx.document;
		if (!document.has(mainId)) return;
		const page = document.pageOf(mainId);
		if (page.id !== document.currentPageId) document.setCurrentPage(page.id);
		this.ctx.selection.select([mainId]);
		this.ctx.viewport.zoomToSelection([mainId]);
	}

	/** Delete a main component; its instances become orphans (restorable from the instance). */
	deleteComponent(mainId: NodeId): void {
		if (!this.ctx.document.has(mainId)) return;
		applyEdit(this.ctx, this.ctx.document.removeNode(mainId), 'Delete component');
	}

	/** Apply a style to the selection by the target its type implies (or `target`). */
	applyStyle(styleId: string, target?: StyleTarget): void {
		const style = this.ctx.styles.get(styleId);
		if (style === undefined || this.ctx.selection.ids.length === 0) return;
		this.ctx.styles.apply(target === undefined ? STYLE_TARGET_OF[style.type] : target, styleId, [
			...this.ctx.selection.ids
		]);
	}

	deleteStyle(styleId: string): void {
		if (this.ctx.styles.get(styleId) === undefined) return;
		this.ctx.styles.remove(styleId);
	}

	startRenamingStyle(styleId: string | null): void {
		this.state.renamingStyleId = styleId;
	}

	snapshotState(): Record<string, unknown> {
		return { query: this.state.query };
	}

	// ---------- internals ----------

	private insertInto(mainId: NodeId, parentId: NodeId, world: Point): NodeId | undefined {
		try {
			const plan = planInstanceAt(this.ctx.document.reader, mainId, parentId, world);
			if (!applyEdit(this.ctx, plan.changes, 'Insert instance')) return undefined;
			this.state.notice = '';
			this.ctx.selection.select([plan.rootId]);
			return plan.rootId;
		} catch (failure) {
			if (!(failure instanceof ComponentCycleError)) throw failure;
			this.state.notice = 'A component cannot contain an instance of itself.';
			return undefined;
		}
	}

	private defaultParent(): NodeId {
		const pageId = this.ctx.document.currentPageId;
		const ids = this.ctx.selection.ids;
		if (ids.length !== 1 || !this.ctx.document.has(ids[0])) return pageId;
		return insertionParent(this.ctx.document.reader, ids[0], pageId);
	}

	private viewportCentre(): Point {
		const rect = this.ctx.viewport.visibleRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	}

	private entryOf(summary: ComponentSummary): ComponentEntry {
		let group = groupPathOf(summary.name);
		let label = leafNameOf(summary.name);
		if (summary.setName !== null) {
			group = summary.setName;
			label = summary.name;
		}
		return {
			id: summary.id,
			name: summary.name,
			label,
			group,
			description: summary.description,
			blocked: this.isBlocked(summary.id)
		};
	}
}

function groupEntries(entries: readonly ComponentEntry[]): ComponentGroup[] {
	const groups = new Map<string, ComponentEntry[]>();
	for (const entry of entries) {
		const members = groups.get(entry.group);
		if (members === undefined) groups.set(entry.group, [entry]);
		else members.push(entry);
	}
	const ordered = [...groups.entries()].map(([group, members]) => ({ group, entries: members }));
	return ordered.sort((left, right) => {
		if (left.group === '') return -1;
		if (right.group === '') return 1;
		return 0;
	});
}

function matches(entry: ComponentEntry, needle: string): boolean {
	if (needle === '') return true;
	if (entry.name.toLowerCase().includes(needle)) return true;
	return entry.group.toLowerCase().includes(needle);
}
