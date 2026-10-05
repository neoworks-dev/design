// The `aiContext` service (#147): model context built from the current selection, for chat,
// generate, rename and the palette. `build()` is the compact text (selection subtree, page and
// frame summary, names of components, variables and styles) within a size budget;
// `selectionAttachment()` wraps it as a prompt attachment; `screenshot()` renders the selection
// (or the first top-level layer) with the headless renderer.

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import {
	buildSelectionContext,
	DEFAULT_CONTEXT_BUDGET,
	type AiContextResult,
	type ContextBudget,
	type ContextSource
} from '../ai/context';
import type { AiAttachment } from '../ai/types';
import type { DocumentService } from './document';
import type { ExportedImage } from '../renderer/exportNode';
import type { SelectionService } from './selection';
import type { VariablesService } from './variables';

declare module '@neoworks/extension-system' {
	interface Context {
		aiContext: AiContextService;
	}
}

/** The part of the headless renderer the context uses. */
export interface ContextRenderer {
	exportNode(
		id: NodeId,
		options: { scale?: number; contentsOnly?: boolean; format?: 'PNG' }
	): Promise<ExportedImage>;
}

/** Longest side of a screenshot for the model, in pixels. */
export const SCREENSHOT_MAX_SIDE = 1024;

export class AiContextService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly selection: SelectionService,
		private readonly variables: VariablesService,
		private readonly renderer: ContextRenderer,
		private readonly budget: ContextBudget = DEFAULT_CONTEXT_BUDGET
	) {
		super(ctx, 'aiContext');
	}

	/** Reactive: the text context of the current selection. */
	build(): AiContextResult {
		return buildSelectionContext(this.source(), this.selection.ids, this.budget);
	}

	/** The selection as a prompt attachment; `undefined` when nothing is selected. */
	selectionAttachment(): AiAttachment | undefined {
		if (this.selection.ids.length === 0) return undefined;
		const result = this.build();
		const note = '\nThe screenshot tool shows the selection; read gives it as HTML.';
		return {
			kind: 'selection',
			label: `Selection (${result.selectedCount})`,
			text: result.text + note
		};
	}

	/** The layer a screenshot shows: `nodeId`, else the first selected, else the first top-level. */
	screenshotTarget(nodeId?: NodeId): NodeId {
		if (nodeId !== undefined) {
			if (!this.document.has(nodeId)) throw new Error(`node ${nodeId} does not exist`);
			return nodeId;
		}
		const selected = this.selection.ids[0];
		if (selected !== undefined) return selected;
		const first = this.document.children(this.document.currentPageId)[0];
		if (first === undefined) throw new Error('the page is empty: there is nothing to screenshot');
		return first;
	}

	/** A PNG of the area of the target layer, drawn with everything that overlaps it. */
	async screenshot(nodeId?: NodeId): Promise<ExportedImage> {
		const target = this.screenshotTarget(nodeId);
		const bounds = this.document.absoluteBounds(target);
		const longest = Math.max(bounds.width, bounds.height, 1);
		const scale = Math.min(1, SCREENSHOT_MAX_SIDE / longest);
		return this.renderer.exportNode(target, { scale, contentsOnly: false, format: 'PNG' });
	}

	snapshotState(): Record<string, unknown> {
		return {};
	}

	private source(): ContextSource {
		const { document, variables } = this;
		return {
			get: (id) => document.get(id),
			children: (id) => document.children(id),
			resolved: (id) => variables.resolvedNode(id),
			pageSummary: () => {
				const page = document.currentPage;
				const topLevel = document
					.children(page.id)
					.map((id) => document.get(id))
					.filter((node): node is Node => node !== undefined);
				return { id: page.id, name: page.name, topLevel };
			},
			componentNames: () =>
				document
					.query((node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
					.map((node) => node.name),
			variableNames: () => variables.variables().map((variable) => variable.name),
			styleNames: () => document.entities('style').map((style) => style.name)
		};
	}
}
