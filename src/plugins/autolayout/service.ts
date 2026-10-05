import { Service, type Context } from '@neoworks/extension-system';
import type { Change, LayoutResult, NodeId } from '../../lib/document';
import { buildLayoutTree, type LayoutNodeSource } from '../../lib/layout/build';
import { computeLayout } from '../../lib/layout/engine';
import { findLayoutRoots, planReflow } from '../../lib/layout/reflow';

declare module '@neoworks/extension-system' {
	interface Context {
		autolayout: AutoLayoutService;
	}
}

/**
 * Auto layout for the rest of the app. Layout results are derived data, but the stored x, y and
 * size of every child are kept in step with them: `reflowFor` plans the changes that do it and
 * the plugin appends them to the transaction that disturbed the layout (`document/append`), so
 * one undo step covers the edit and its reflow, and every consumer (renderer, hit testing,
 * export, plugins, AI) reads plain geometry.
 */
export class AutoLayoutService extends Service {
	constructor(ctx: Context) {
		super(ctx, 'autolayout');
	}

	/** Changes that lay out every auto layout tree the applied `changes` disturbed. */
	reflowFor(changes: Change[]): Change[] {
		const reader = this.ctx.document.reader;
		const source = this.source();
		const planned: Change[] = [];
		for (const rootId of findLayoutRoots(reader, changes)) {
			planned.push(...planReflow(reader, source, rootId));
		}
		return planned;
	}

	/** Changes that lay out the tree under one container (for example after a bulk edit). */
	reflowTree(rootId: NodeId): Change[] {
		return planReflow(this.ctx.document.reader, this.source(), rootId);
	}

	/** Where the engine would put every node of the tree under `rootId`; nothing is written. */
	layoutOf(rootId: NodeId): Map<NodeId, LayoutResult> {
		return computeLayout(buildLayoutTree(this.source(), rootId));
	}

	snapshotState(): unknown {
		return {};
	}

	private source(): LayoutNodeSource {
		return {
			node: (id) => this.ctx.variables.resolvedNode(id),
			children: (id) => this.ctx.document.children(id),
			measureText: (node, width) => this.ctx.textLayout.measureAt(node.id, width)
		};
	}
}
