// The `snapping` service (#69): snap a moving or resizing rectangle to nearby objects.
//
//   const { delta, guides } = ctx.snapping.snap(movingRect, { parentId, ignoreIds: selection });
//
// Candidates are the boxes of the siblings in `parentId`, the parent's own box (unless it is the
// page) and the edges of top-level frames, all limited to what the viewport shows (spatial index
// query). The pure algorithm is lib/snapping/snap.ts. The result also lands in `guides`, which the
// overlay layer draws; `release()` (pointer up, cancel) clears it, so guides exist only while a
// snap is active.

import { Service, type Context } from '@neoworks/extension-system';
import { isFrameLike, type Node, type NodeId, type Rect } from '../document';
import {
	snapRect,
	type Axis,
	type LineKind,
	type SnapGuide,
	type SnapResult
} from '../snapping/snap';
import type { DocumentService } from './document';
import type { SnappingState } from './snappingState.svelte';
import type { SpatialService } from './spatial';

declare module '@neoworks/extension-system' {
	interface Context {
		snapping: SnappingService;
	}
}

/** Screen pixels within which an edge snaps. */
export const DEFAULT_SNAP_THRESHOLD_PIXELS = 5;

export interface SnapRequest {
	/** The container the moved nodes live in (or the draw target); the page when omitted. */
	parentId?: NodeId;
	/** Nodes being moved: never snap to themselves. */
	ignoreIds?: readonly NodeId[];
	axes?: 'both' | Axis;
	/** Lines of the moving rect that may snap; a resize passes only the edges being dragged. */
	lines?: { x?: readonly LineKind[]; y?: readonly LineKind[] };
	/** Ctrl/Cmd held: skip snapping for this call. */
	bypass?: boolean;
}

/** What the service needs from the viewport. */
export interface SnapViewport {
	readonly zoom: number;
	visibleRect(): Rect;
}

export class SnappingService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly spatial: SpatialService,
		private readonly viewport: SnapViewport,
		private readonly state: SnappingState,
		private readonly thresholdPixels: number
	) {
		super(ctx, 'snapping');
	}

	get enabled(): boolean {
		return this.state.enabled;
	}

	setEnabled(enabled: boolean): void {
		this.state.enabled = enabled;
		if (!enabled) this.release();
	}

	/** Active guides (reactive); empty unless a snap is in progress. */
	get guides(): readonly SnapGuide[] {
		return this.state.guides;
	}

	/** Snap threshold in page units at the current zoom. */
	get threshold(): number {
		return this.thresholdPixels / this.viewport.zoom;
	}

	snap(moving: Rect, request: SnapRequest = {}): SnapResult {
		if (!this.state.enabled || request.bypass === true) return this.noSnap();
		const candidates = this.candidateRects(moving, request);
		const result = snapRect(moving, candidates, {
			threshold: this.threshold,
			axes: request.axes,
			lines: request.lines
		});
		this.state.guides = result.guides;
		return result;
	}

	/** Pointer up or cancel: nothing is snapped any more. */
	release(): void {
		this.state.guides = [];
	}

	/** The rectangles `snap` would consider for `moving`. Exposed for tools and tests. */
	candidateRects(moving: Rect, request: SnapRequest = {}): Rect[] {
		const pageId = this.document.currentPageId;
		const parentId = request.parentId === undefined ? pageId : request.parentId;
		const ignored = new Set<NodeId>();
		if (request.ignoreIds !== undefined) for (const id of request.ignoreIds) ignored.add(id);
		const slack = this.threshold;
		const area = this.viewportArea(moving, slack);
		const rects = new Map<NodeId, Rect>();
		for (const id of this.spatial.visible(area, pageId)) {
			const node = this.document.get(id);
			if (!node || ignored.has(id)) continue;
			if (!this.isCandidate(node, parentId, pageId)) continue;
			rects.set(id, this.spatial.absoluteBounds(id));
		}
		if (parentId !== pageId && !ignored.has(parentId)) {
			rects.set(parentId, this.spatial.absoluteBounds(parentId));
		}
		return [...rects.values()];
	}

	private isCandidate(node: Node, parentId: NodeId, pageId: NodeId): boolean {
		if (node.type === 'PAGE' || !node.visible) return false;
		if (node.parentId === parentId) return true;
		return node.parentId === pageId && isFrameLike(node);
	}

	/** The viewport, grown to include the moving rect so a drag near the edge still snaps. */
	private viewportArea(moving: Rect, slack: number): Rect {
		const view = this.viewport.visibleRect();
		const left = Math.min(view.x, moving.x - slack);
		const top = Math.min(view.y, moving.y - slack);
		const right = Math.max(view.x + view.width, moving.x + moving.width + slack);
		const bottom = Math.max(view.y + view.height, moving.y + moving.height + slack);
		return { x: left, y: top, width: right - left, height: bottom - top };
	}

	private noSnap(): SnapResult {
		this.release();
		return { delta: { x: 0, y: 0 }, guides: [] };
	}
}
