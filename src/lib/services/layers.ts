// The `layers` service: the layers panel's model. It turns the current page into rows, owns
// expand/collapse and rename state, and maps row clicks to selection changes. Components read it
// through `ctx.layers`; everything reactive lives in `LayersState`.

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import type { LayersState } from '../layers/layersState.svelte';
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
		return flattenLayers(this.document, this.document.currentPageId, {
			isExpanded: (id) => this.state.expanded.has(id)
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

	// ---------- rename ----------

	startRename(id: NodeId): void {
		if (!this.document.has(id)) return;
		this.state.renamingId = id;
	}

	stopRename(): void {
		this.state.renamingId = null;
	}

	snapshotState(): unknown {
		return { expanded: this.state.expanded.size, renaming: this.state.renamingId };
	}
}
