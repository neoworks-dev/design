// The `hitTest` service (#41): what is under a page-space point, with selection scope rules.
// The algorithm is lib/document/hitTest.ts; this adds the current page and the selection scope.

import { Service, type Context } from '@neoworks/extension-system';
import { HitTester, type Hit, type NodeId } from '../document';
import type { DocumentService } from './document';
import type { SelectionService } from './selection';
import type { SpatialService } from './spatial';

declare module '@neoworks/extension-system' {
	interface Context {
		hitTest: HitTestService;
	}
}

export interface PointQuery {
	/** Page space. */
	point: { x: number; y: number };
	/** Slack in page units: screen pixels divided by the zoom. Default 0. */
	tolerance?: number;
	/** Defaults to the current page. */
	pageId?: NodeId;
}

export class HitTestService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly spatial: SpatialService,
		private readonly selection: SelectionService
	) {
		super(ctx, 'hitTest');
	}

	/** Click: the node selected at the current selection scope. */
	topAtScope(query: PointQuery): NodeId | undefined {
		return this.tester().topAtScope(this.pageOf(query), query.point, {
			tolerance: query.tolerance,
			scopeId: this.selection.scopeId
		});
	}

	/** Ctrl+click: the deepest node under the cursor, ignoring scope. */
	deepest(query: PointQuery): NodeId | undefined {
		return this.tester().deepest(this.pageOf(query), query.point, { tolerance: query.tolerance });
	}

	/** Every layer under the cursor, topmost first (context menu "Select layer"). */
	all(query: PointQuery): NodeId[] {
		return this.tester().all(this.pageOf(query), query.point, { tolerance: query.tolerance });
	}

	/** Detailed hits (node and what was hit), topmost first. */
	hits(query: PointQuery): Hit[] {
		return this.tester().hits(this.pageOf(query), query.point, { tolerance: query.tolerance });
	}

	/** The top-level frame whose title label is under the point. */
	frameTitle(query: PointQuery, zoom: number): NodeId | undefined {
		return this.tester().frameTitle(this.pageOf(query), query.point, { zoom });
	}

	private tester(): HitTester {
		return new HitTester(this.document.reader, this.spatial.sceneIndex);
	}

	private pageOf(query: PointQuery): NodeId {
		if (query.pageId !== undefined) return query.pageId;
		return this.document.currentPageId;
	}
}
