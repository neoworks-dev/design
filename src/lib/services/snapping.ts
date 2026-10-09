// The `snapping` service: snap a moving or resizing rectangle to nearby objects (#69), with equal
// spacing guides (#70), and measure distances between objects (#70).
//
//   const { delta, guides, gaps } = ctx.snapping.snap(movingRect, { parentId, ignoreIds });
//
// Candidates are the boxes of the siblings in `parentId`, the parent's own box (unless it is the
// page) and the edges of top-level frames, all limited to what the viewport shows (spatial index
// query). The pure algorithms are lib/snapping/{snap,spacing,measure}.ts. The result also lands in
// `guides` / `gaps` (reactive), which the overlay layer draws; `release()` (pointer up, cancel)
// clears them, so guides exist only while a snap is active. `measure()` fills `measurement` the
// same way for Alt+hover.

import { Service, type Context } from '@neoworks/extension-system';
import { isFrameLike, type Node, type NodeId, type Rect } from '../document';
import {
	measureBetween,
	projectMeasurement,
	type Measurement,
	type ScreenMeasureLine
} from '../snapping/measure';
import {
	snapRect,
	type Axis,
	type LineKind,
	type Point,
	type SnapGuide,
	type SnapResult
} from '../snapping/snap';
import { snapToLines, type SnapLine } from '../snapping/lineSnap';
import { pixelDelta } from '../snapping/pixel';
import { snapSpacing, type GapGuide } from '../snapping/spacing';
import type { DocumentService } from './document';
import type { SnappingState } from './snappingState.svelte';
import type { SpatialService } from './spatial';

declare module '@neoworks/extension-system' {
	interface Context {
		snapping: SnappingService;
	}
}

/** Screen pixels within which an edge snaps. */
export const DEFAULT_SNAP_THRESHOLD_PIXELS = 4;

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
	/** Equal-spacing snaps: on for moves (default), never for resizes (`lines` given). */
	spacing?: boolean;
}

export interface SnapOutcome extends SnapResult {
	/** Equal-spacing brackets with their distances; empty when no spacing snap is active. */
	gaps: GapGuide[];
}

export interface MeasureRequest {
	/** The selected nodes; their union is measured from. */
	selectionIds: readonly NodeId[];
	/** The hovered node. */
	targetId: NodeId;
	/** Ctrl+Alt: only measure objects inside the selection's own container (group scope). */
	groupScope?: boolean;
}

/** What the service needs from the viewport. */
export interface SnapViewport {
	readonly zoom: number;
	visibleRect(): Rect;
	worldToScreen(point: Point): Point;
}

interface CandidateSet {
	neighbours: Rect[];
	parent: Rect | undefined;
}

interface CachedNeighbours {
	ignoreIds: readonly NodeId[];
	key: string;
	neighbours: Rect[];
}

export class SnappingService extends Service {
	private readonly lineSources = new Set<() => readonly SnapLine[]>();
	private cachedNeighbours: CachedNeighbours | null = null;

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

	/** Active equal-spacing brackets (reactive). */
	get gaps(): readonly GapGuide[] {
		return this.state.gaps;
	}

	/** The current Alt+hover measurement (reactive); null when none. */
	get measurement(): Measurement | null {
		return this.state.measurement;
	}

	/** Snap threshold in page units at the current zoom. */
	get threshold(): number {
		return this.thresholdPixels / this.viewport.zoom;
	}

	get pixelSnapEnabled(): boolean {
		return this.state.pixelSnap;
	}

	setPixelSnap(enabled: boolean): void {
		this.state.pixelSnap = enabled;
	}

	/**
	 * Object snapping (when "Snap to objects" is on) then pixel grid snapping (when on): an axis
	 * an object already snapped keeps that shift, every other axis rounds to whole pixels.
	 */
	snap(moving: Rect, request: SnapRequest = {}): SnapOutcome {
		if (request.bypass === true) return this.noSnap();
		if (!this.state.enabled && !this.state.pixelSnap) return this.noSnap();
		let outcome: SnapOutcome = { delta: { x: 0, y: 0 }, guides: [], gaps: [] };
		const lineAxes: Axis[] = [];
		if (this.state.enabled) {
			outcome = this.snapToObjects(moving, request);
			outcome = this.withLineSnap(moving, outcome, request, lineAxes);
		}
		if (this.state.pixelSnap) outcome = this.withPixelSnap(moving, outcome, request, lineAxes);
		this.state.guides = outcome.guides;
		this.state.gaps = outcome.gaps;
		return outcome;
	}

	/**
	 * Adds lines objects snap to besides other objects (ruler guides). `source` is read on every
	 * snap, so it can follow reactive state. The disposer removes exactly this source.
	 */
	addLineSource(source: () => readonly SnapLine[]): () => void {
		this.lineSources.add(source);
		return () => void this.lineSources.delete(source);
	}

	private withLineSnap(
		moving: Rect,
		outcome: SnapOutcome,
		request: SnapRequest,
		snappedAxes: Axis[]
	): SnapOutcome {
		if (this.lineSources.size === 0) return outcome;
		const lines = [...this.lineSources].flatMap((source) => source());
		const shifts = snapToLines(moving, lines, {
			threshold: this.threshold,
			axes: request.axes,
			lines: request.lines
		});
		const delta = { ...outcome.delta };
		let guides = [...outcome.guides];
		let gaps = [...outcome.gaps];
		for (const axis of ['x', 'y'] as const) {
			const shift = shifts[axis];
			if (shift === undefined) continue;
			const objectSnapped =
				guides.some((guide) => guide.axis === axis) || gaps.some((gap) => gap.axis === axis);
			if (objectSnapped && Math.abs(outcome.delta[axis]) < Math.abs(shift)) continue;
			delta[axis] = shift;
			guides = guides.filter((guide) => guide.axis !== axis);
			gaps = gaps.filter((gap) => gap.axis !== axis);
			snappedAxes.push(axis);
		}
		return { delta, guides, gaps };
	}

	private snapToObjects(moving: Rect, request: SnapRequest): SnapOutcome {
		const candidates = this.candidateSet(moving, request);
		const objectRects = [...candidates.neighbours];
		if (candidates.parent) objectRects.push(candidates.parent);
		const objects = snapRect(moving, objectRects, {
			threshold: this.threshold,
			axes: request.axes,
			lines: request.lines
		});
		return this.withSpacing(moving, candidates.neighbours, objects, request);
	}

	private withPixelSnap(
		moving: Rect,
		outcome: SnapOutcome,
		request: SnapRequest,
		lineAxes: readonly Axis[]
	): SnapOutcome {
		const rounding = pixelDelta(moving, { axes: request.axes, lines: request.lines });
		const delta = { ...outcome.delta };
		for (const axis of ['x', 'y'] as const) {
			const objectSnapped =
				lineAxes.includes(axis) ||
				outcome.guides.some((guide) => guide.axis === axis) ||
				outcome.gaps.some((gap) => gap.axis === axis);
			if (!objectSnapped) delta[axis] = rounding[axis];
		}
		return { ...outcome, delta };
	}

	/** Pointer up or cancel: nothing is snapped any more. */
	release(): void {
		this.state.guides = [];
		this.state.gaps = [];
		this.cachedNeighbours = null;
	}

	/** The rectangles `snap` would consider for `moving`. Exposed for tools and tests. */
	candidateRects(moving: Rect, request: SnapRequest = {}): Rect[] {
		const candidates = this.candidateSet(moving, request);
		if (!candidates.parent) return candidates.neighbours;
		return [...candidates.neighbours, candidates.parent];
	}

	/**
	 * Distances from the selection to the hovered node, and to the selection's container when it
	 * has one. Stores the result in `measurement`; returns it.
	 */
	measure(request: MeasureRequest): Measurement {
		const empty: Measurement = { target: [], container: [] };
		const selected = this.unionBounds(request.selectionIds);
		const target = this.document.get(request.targetId);
		if (!selected || !target || target.type === 'PAGE') return this.setMeasurement(empty);
		if (request.selectionIds.includes(request.targetId)) return this.setMeasurement(empty);
		const containerId = this.commonParent(request.selectionIds);
		if (request.groupScope === true && target.parentId !== containerId) {
			return this.setMeasurement(empty);
		}
		const lines = measureBetween(selected, this.spatial.absoluteBounds(request.targetId));
		const container = this.containerLines(selected, containerId, request.targetId);
		return this.setMeasurement({ target: lines, container });
	}

	/** Hover left or Alt released. */
	clearMeasurement(): void {
		this.state.measurement = null;
	}

	/** Measurement lines in screen space, for the overlay; lengths scale with the zoom. */
	projectMeasurement(lines: Measurement['target']): ScreenMeasureLine[] {
		return projectMeasurement(lines, (point) => this.viewport.worldToScreen(point));
	}

	// ---------- internals ----------

	private withSpacing(
		moving: Rect,
		neighbours: Rect[],
		objects: SnapResult,
		request: SnapRequest
	): SnapOutcome {
		const wanted = request.spacing !== false && request.lines === undefined;
		if (!wanted) return { ...objects, gaps: [] };
		const spacing = snapSpacing(moving, neighbours, {
			threshold: this.threshold,
			axes: request.axes
		});
		const delta = { ...objects.delta };
		let guides = [...objects.guides];
		const gaps: GapGuide[] = [];
		for (const axis of spacing.snappedAxes) {
			const objectSnapped = guides.some((guide) => guide.axis === axis);
			if (objectSnapped && Math.abs(objects.delta[axis]) <= Math.abs(spacing.delta[axis])) continue;
			delta[axis] = spacing.delta[axis];
			guides = guides.filter((guide) => guide.axis !== axis);
			gaps.push(...spacing.gaps.filter((gap) => gap.axis === axis));
		}
		return { delta, guides, gaps };
	}

	private candidateSet(moving: Rect, request: SnapRequest): CandidateSet {
		const pageId = this.document.currentPageId;
		let parentId = pageId;
		if (request.parentId !== undefined) parentId = request.parentId;
		const neighbours = this.neighbours(moving, pageId, parentId, request);
		const ignoresParent = request.ignoreIds !== undefined && request.ignoreIds.includes(parentId);
		if (parentId === pageId || ignoresParent) return { neighbours, parent: undefined };
		// Not cached: resizing a child can resize a hugging parent.
		return { neighbours, parent: this.spatial.absoluteBounds(parentId) };
	}

	/**
	 * Within one gesture only the moving nodes change, and they are ignored, so the neighbours are
	 * kept while the caller passes the same `ignoreIds` array (until `release`). Scanning every
	 * visible node on every pointer move is what made dragging slow in large scenes.
	 */
	private neighbours(moving: Rect, pageId: NodeId, parentId: NodeId, request: SnapRequest): Rect[] {
		const area = this.viewportArea(moving, this.threshold);
		const key = `${pageId} ${parentId} ${area.x} ${area.y} ${area.width} ${area.height}`;
		const cached = this.cachedNeighbours;
		if (cached !== null && cached.ignoreIds === request.ignoreIds && cached.key === key) {
			return cached.neighbours;
		}
		const neighbours = this.collectNeighbours(pageId, parentId, area, request.ignoreIds);
		this.cachedNeighbours = null;
		if (request.ignoreIds !== undefined) {
			this.cachedNeighbours = { ignoreIds: request.ignoreIds, key, neighbours };
		}
		return neighbours;
	}

	private collectNeighbours(
		pageId: NodeId,
		parentId: NodeId,
		area: Rect,
		ignoreIds: readonly NodeId[] | undefined
	): Rect[] {
		const ignored = new Set<NodeId>(ignoreIds);
		const neighbours: Rect[] = [];
		for (const id of this.spatial.visible(area, pageId)) {
			const node = this.document.get(id);
			if (!node || ignored.has(id) || id === parentId) continue;
			if (!this.isCandidate(node, parentId, pageId)) continue;
			neighbours.push(this.spatial.absoluteBounds(id));
		}
		return neighbours;
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

	private noSnap(): SnapOutcome {
		this.release();
		return { delta: { x: 0, y: 0 }, guides: [], gaps: [] };
	}

	private unionBounds(ids: readonly NodeId[]): Rect | undefined {
		let union: Rect | undefined;
		for (const id of ids) {
			if (!this.document.has(id)) continue;
			const bounds = this.spatial.absoluteBounds(id);
			if (!union) {
				union = bounds;
				continue;
			}
			const left = Math.min(union.x, bounds.x);
			const top = Math.min(union.y, bounds.y);
			const right = Math.max(union.x + union.width, bounds.x + bounds.width);
			const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
			union = { x: left, y: top, width: right - left, height: bottom - top };
		}
		return union;
	}

	/** The parent shared by all ids, or null when they differ. */
	private commonParent(ids: readonly NodeId[]): NodeId | null {
		let common: NodeId | null = null;
		for (const id of ids) {
			const node = this.document.get(id);
			if (!node) continue;
			if (common !== null && node.parentId !== common) return null;
			common = node.parentId;
		}
		return common;
	}

	/** Insets to the selection's container, unless it is the page or is the hovered node itself. */
	private containerLines(
		selected: Rect,
		containerId: NodeId | null,
		targetId: NodeId
	): Measurement['container'] {
		if (containerId === null || containerId === targetId) return [];
		const container = this.document.get(containerId);
		if (!container || container.type === 'PAGE') return [];
		return measureBetween(selected, this.spatial.absoluteBounds(containerId));
	}

	private setMeasurement(measurement: Measurement): Measurement {
		this.state.measurement = measurement;
		return measurement;
	}
}
