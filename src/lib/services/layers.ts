// The `layers` service: the layers panel's model. It turns the current page into rows, owns
// expand/collapse and rename state, and maps row clicks to selection changes. Components read it
// through `ctx.layers`; everything reactive lives in `LayersState`.

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import {
	draggableIds,
	dropZone,
	type DropZone,
	fractionInRow,
	planLayerDrop,
	resolveDrop,
	rowIndexAt
} from '../layers/dropPlan';
import type { LayerDrag, LayersState } from '../layers/layersState.svelte';
import {
	isFilterActive,
	layersMatching,
	planIsolateFlag,
	planToggleFlag,
	type LayerFilter,
	type LayerFlag,
	type LayerTypeFilter
} from '../layers/rowActions';
import { planRename } from '../editing/nodeCommands';
import { containersBelow, flattenLayers, rangeBetween, type LayerRow } from '../layers/tree';
import type { DocumentService } from './document';
import type { SelectionService } from './selection';

declare module '@neoworks/extension-system' {
	interface Context {
		layers: LayersService;
	}
}

export interface RowClickModifiers {
	shiftKey: boolean;
	/** Ctrl or Cmd. */
	toggleKey: boolean;
}

export class LayersService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly selection: SelectionService,
		private readonly state: LayersState
	) {
		super(ctx, 'layers');
	}

	// ---------- reads (reactive) ----------

	/** The visible rows of the current page, top-most layer first. */
	rows(): LayerRow[] {
		const pageId = this.document.currentPageId;
		return flattenLayers(this.document, pageId, {
			isExpanded: (id) => this.state.expanded.has(id),
			only: layersMatching(this.document.reader, pageId, this.filter) ?? undefined
		});
	}

	isExpanded(id: NodeId): boolean {
		return this.state.expanded.has(id);
	}

	get renamingId(): NodeId | null {
		return this.state.renamingId;
	}

	// ---------- expand and collapse ----------

	setExpanded(id: NodeId, expanded: boolean): void {
		if (expanded) this.state.expanded.add(id);
		else this.state.expanded.delete(id);
	}

	toggleExpanded(id: NodeId): void {
		this.setExpanded(id, !this.isExpanded(id));
	}

	/** Expand or collapse `id` and every container below it (Alt+click on the chevron). */
	toggleExpandedDeep(id: NodeId): void {
		const expand = !this.isExpanded(id);
		for (const containerId of containersBelow(this.document, id)) {
			this.setExpanded(containerId, expand);
		}
	}

	collapseAll(): void {
		this.state.expanded.clear();
	}

	/** Expand the ancestors of `ids` so their rows are listed. */
	reveal(ids: readonly NodeId[]): void {
		for (const id of ids) {
			for (const ancestor of this.document.ancestors(id)) {
				if (ancestor.type === 'PAGE') continue;
				this.state.expanded.add(ancestor.id);
			}
		}
	}

	// ---------- selection ----------

	/** A click on a row: plain replaces, Ctrl toggles, Shift selects the range from the anchor. */
	clickRow(id: NodeId, modifiers: RowClickModifiers): void {
		if (modifiers.shiftKey) {
			const range = rangeBetween(this.rows(), this.state.anchorId, id);
			this.selection.select(range, 'replace', { source: 'layers' });
			return;
		}
		this.state.anchorId = id;
		const mode = modifiers.toggleKey ? 'toggle' : 'replace';
		this.selection.select([id], mode, { source: 'layers' });
	}

	// ---------- drag and drop ----------

	/** Reactive: the drag in progress, or null. */
	get drag(): LayerDrag | null {
		return this.state.drag;
	}

	/**
	 * Start dragging `rowId`: the whole selection when the row is part of it, else just the row.
	 * Returns false when nothing there can be moved.
	 */
	beginDrag(rowId: NodeId): boolean {
		if (this.filtering) return false;
		const source = this.selection.has(rowId) ? this.selection.ids : [rowId];
		const ids = draggableIds(this.document.reader, source);
		if (ids.length === 0) return false;
		this.state.drag = { ids, drop: null };
		return true;
	}

	/** The pointer is at `contentY` in the row list, `pointerDepth` indent levels from its left. */
	updateDrag(contentY: number, pointerDepth: number): void {
		const drag = this.state.drag;
		if (!drag) return;
		const rows = this.rows();
		const rowIndex = rowIndexAt(contentY, rows.length);
		const row = rows.at(rowIndex);
		// Below the last row the zone is not used: the drop goes under the last layer.
		let zone: DropZone = 'after';
		if (row) zone = dropZone(this.document.require(row.id), fractionInRow(contentY));
		const drop = resolveDrop(
			this.document.reader,
			rows,
			this.document.currentPageId,
			rowIndex,
			zone,
			pointerDepth,
			drag.ids
		);
		this.state.drag = { ids: drag.ids, drop };
	}

	cancelDrag(): void {
		this.state.drag = null;
	}

	/** Apply the drop as one transaction (one undo step). Returns whether anything moved. */
	commitDrag(): boolean {
		const drag = this.state.drag;
		this.state.drag = null;
		if (!drag || drag.drop === null) return false;
		const changes = planLayerDrop(this.document.reader, drag.ids, drag.drop.destination);
		if (changes === null || changes.length === 0) return false;
		this.document.apply(changes, { origin: 'user', label: 'Move layers' });
		this.setExpanded(drag.drop.destination.parentId, true);
		return true;
	}

	// ---------- visibility and lock ----------

	/** Eye and lock buttons. With `isolate` (Alt) the layer's siblings follow, see `planIsolateFlag`. */
	toggleFlag(id: NodeId, flag: LayerFlag, isolate: boolean): void {
		const reader = this.document.reader;
		const changes = isolate ? planIsolateFlag(reader, id, flag) : planToggleFlag(reader, id, flag);
		if (changes.length === 0) return;
		const label = flag === 'visible' ? 'Show/Hide layer' : 'Lock/Unlock layer';
		this.document.apply(changes, { origin: 'user', label });
	}

	// ---------- rename ----------

	startRename(id: NodeId): void {
		if (!this.document.has(id)) return;
		this.reveal([id]);
		this.state.renamingId = id;
	}

	stopRename(): void {
		this.state.renamingId = null;
	}

	/**
	 * Commit the inline rename. An empty or unchanged name keeps the old one. `step` moves the
	 * rename to the next (1) or previous (-1) listed layer (Tab / Shift+Tab); 0 ends renaming.
	 */
	commitRename(name: string, step: -1 | 0 | 1): void {
		const id = this.state.renamingId;
		if (id === null) return;
		this.state.renamingId = null;
		this.applyRename(id, name);
		if (step === 0) return;
		const rows = this.rows();
		const position = rows.findIndex((row) => row.id === id);
		const next = rows.at(position + step);
		if (position >= 0 && next) this.startRename(next.id);
	}

	private applyRename(id: NodeId, name: string): void {
		if (name.trim().length === 0) return;
		const changes = planRename(this.document.reader, id, name);
		if (changes.length === 0) return;
		this.document.apply(changes, { origin: 'user', label: 'Rename layer' });
	}

	// ---------- search and filter ----------

	get filter(): LayerFilter {
		return { query: this.state.query, types: this.state.types };
	}

	get filterOpen(): boolean {
		return this.state.filterOpen;
	}

	get filtering(): boolean {
		return isFilterActive(this.filter);
	}

	openFilter(): void {
		this.state.filterOpen = true;
	}

	/** Close the search bar and drop the filter. */
	closeFilter(): void {
		this.state.filterOpen = false;
		this.state.query = '';
		this.state.types = [];
	}

	setQuery(query: string): void {
		this.state.query = query;
	}

	toggleType(type: LayerTypeFilter): void {
		const types = this.state.types;
		if (types.includes(type)) this.state.types = types.filter((entry) => entry !== type);
		else this.state.types = [...types, type];
	}

	snapshotState(): unknown {
		return { expanded: this.state.expanded.size, renaming: this.state.renamingId };
	}
}
