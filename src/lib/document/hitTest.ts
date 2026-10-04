// Hit testing (#41): from the spatial index's candidates to what is really under the cursor.
//
// Pipeline for a page-space point:
//   1. candidates: `SceneIndex.atPoint` (render bounds within the tolerance), a superset;
//   2. exact test per candidate: inverse-transform the point into node space and measure the signed
//      distance to the outline (shapeGeometry.ts), against fills and strokes;
//   3. drop hidden and locked nodes (the node or any ancestor), points outside a clipping ancestor,
//      and points outside the mask that clips the node (a mask clips its later siblings);
//   4. sort by paint order, top first; the selection mode then picks from the sorted hits.
//
// Selection scope rules follow docs/research/interactions.md section 3 (facts tagged [K] there are
// unverified; the places that rely on them are marked below).
//
// Not exact yet: vectors, text, polygons, stars, boolean operations answer with their bounding box
// (`geometryKind` 'box') until vector networks and text layout exist; `strokes` on those do not
// widen the hit area. `itemReverseZIndex` of auto layout is not applied to paint order.

import { invertMatrix, transformPoint } from './matrix';
import {
	geometryKind,
	hasVisibleFill,
	isFrameLike,
	signedDistance,
	strokeExtent
} from './shapeGeometry';
import type { SceneIndex } from './sceneIndex';
import type { DocumentReader } from './store';
import type { Matrix2x3, Node, NodeId } from './types';

export type HitKind = 'fill' | 'stroke' | 'area';

export interface Hit {
	id: NodeId;
	/**
	 * `fill` / `stroke`: painted pixels were hit. `area`: the empty inside of a frame (no paint
	 * there); transparent for single-click selection, a fallback for deep select.
	 */
	kind: HitKind;
}

export interface HitOptions {
	/** Slack around the point in page units (a few screen pixels divided by the zoom). */
	tolerance?: number;
}

export interface ScopeHitOptions extends HitOptions {
	/** The container whose children a click selects; the page (or null) when unscoped. */
	scopeId?: NodeId | null;
}

export interface FrameTitleOptions {
	zoom: number;
}

const TITLE_HEIGHT_PIXELS = 24;
const TITLE_CHARACTER_PIXELS = 7;
const TITLE_PADDING_PIXELS = 12;

/** A path of fractional indexes from the page's child down; compares in paint order. */
type PaintKey = string[];

function comparePaintKeys(first: PaintKey, second: PaintKey): number {
	const shared = Math.min(first.length, second.length);
	for (let position = 0; position < shared; position += 1) {
		if (first[position] < second[position]) return -1;
		if (first[position] > second[position]) return 1;
	}
	return first.length - second.length;
}

interface LocalSpace {
	local: { x: number; y: number };
	/** Page units per local unit, for converting the tolerance. */
	scale: number;
}

export class HitTester {
	constructor(
		private readonly store: DocumentReader,
		private readonly index: SceneIndex
	) {}

	/** Every hit at the point, topmost first. */
	hits(pageId: NodeId, point: { x: number; y: number }, options: HitOptions = {}): Hit[] {
		let tolerance = 0;
		if (options.tolerance !== undefined) tolerance = options.tolerance;
		const found: { hit: Hit; key: PaintKey }[] = [];
		for (const id of this.index.atPoint(pageId, point, tolerance)) {
			const entry = this.testCandidate(pageId, id, point, tolerance);
			if (entry) found.push(entry);
		}
		found.sort((first, second) => comparePaintKeys(second.key, first.key));
		return found.map((entry) => entry.hit);
	}

	/** Every layer under the cursor, topmost first (context menu "Select layer"). */
	all(pageId: NodeId, point: { x: number; y: number }, options: HitOptions = {}): NodeId[] {
		return this.hits(pageId, point, options).map((hit) => hit.id);
	}

	/** Ctrl+click: the topmost painted node whatever its nesting; a frame's empty area last. */
	deepest(
		pageId: NodeId,
		point: { x: number; y: number },
		options: HitOptions = {}
	): NodeId | undefined {
		const hits = this.hits(pageId, point, options);
		const painted = hits.find((hit) => hit.kind !== 'area');
		if (painted) return painted.id;
		if (hits.length === 0) return undefined;
		return hits[0].id;
	}

	/** Plain click: the node a click selects at the given scope, or undefined for nothing. */
	topAtScope(
		pageId: NodeId,
		point: { x: number; y: number },
		options: ScopeHitOptions = {}
	): NodeId | undefined {
		let fallback: NodeId | undefined;
		for (const hit of this.hits(pageId, point, options)) {
			const chain = this.chainOf(hit.id);
			const target = this.targetAtScope(chain, pageId, options.scopeId);
			if (target) {
				if (hit.kind === 'area') continue;
				return target.id;
			}
			const node = chain[0];
			const topLevel = node.parentId === pageId;
			if (hit.kind === 'area') {
				// [K] a top-level frame without fill is selected by clicking its empty area.
				if (topLevel && fallback === undefined) fallback = node.id;
				continue;
			}
			if (hit.kind === 'stroke' && topLevel && !hasVisibleFill(node)) return node.id;
			// Opaque background of the scope container: it occludes everything below it.
			return fallback;
		}
		return fallback;
	}

	/**
	 * The top-level frame whose title label is at `point`. Labels sit above the frame's top-left
	 * corner, a fixed number of screen pixels tall, as wide as the name (capped by the frame).
	 */
	frameTitle(
		pageId: NodeId,
		point: { x: number; y: number },
		options: FrameTitleOptions
	): NodeId | undefined {
		const height = TITLE_HEIGHT_PIXELS / options.zoom;
		const candidates = this.index.atPoint(pageId, point, height, 'box');
		const titled: { id: NodeId; key: string }[] = [];
		for (const id of candidates) {
			const node = this.store.requireNode(id);
			if (node.parentId !== pageId || !this.hasTitle(node)) continue;
			if (this.titleContains(node, point, options.zoom)) titled.push({ id, key: node.index });
		}
		titled.sort((first, second) => (first.key < second.key ? 1 : -1));
		if (titled.length === 0) return undefined;
		return titled[0].id;
	}

	// ---------- candidate test ----------

	private testCandidate(
		pageId: NodeId,
		id: NodeId,
		point: { x: number; y: number },
		tolerance: number
	): { hit: Hit; key: PaintKey } | undefined {
		const node = this.store.requireNode(id);
		if (geometryKind(node) === 'none') return undefined;
		const chain = this.chainOf(id);
		if (!this.isInteractive(chain)) return undefined;
		const space = this.localSpace(id, point);
		if (!space) return undefined;
		const kind = this.classify(node, space, tolerance);
		if (!kind) return undefined;
		if (!this.insideClips(chain, point)) return undefined;
		if (!this.insideMasks(pageId, chain, point)) return undefined;
		return { hit: { id, kind }, key: this.paintKey(chain) };
	}

	/** The node first, then its ancestors, ending with the page. */
	private chainOf(id: NodeId): Node[] {
		return [this.store.requireNode(id), ...this.store.ancestors(id)];
	}

	private isInteractive(chain: Node[]): boolean {
		for (const node of chain) {
			if (node.type === 'PAGE') continue;
			if (!node.visible || node.locked) return false;
		}
		return true;
	}

	private localSpace(id: NodeId, point: { x: number; y: number }): LocalSpace | undefined {
		const transform: Matrix2x3 = this.index.absoluteTransform(id);
		const inverse = invertMatrix(transform);
		if (!inverse) return undefined;
		const [[a, c], [b, d]] = transform;
		return {
			local: transformPoint(inverse, point.x, point.y),
			scale: Math.sqrt(Math.abs(a * d - b * c))
		};
	}

	private classify(node: Node, space: LocalSpace, tolerance: number): HitKind | undefined {
		const distance = signedDistance(node, space.local.x, space.local.y);
		if (distance === undefined) return undefined;
		const slack = tolerance / space.scale;
		const kind = geometryKind(node);
		const extent = strokeExtent(node);
		if (kind === 'box') return distance <= slack ? 'fill' : undefined;
		if (kind === 'line') return this.classifyLine(distance, slack, extent.outer);
		if (this.isMask(node)) return distance <= slack ? 'fill' : undefined;
		if (hasVisibleFill(node) && distance <= slack) return 'fill';
		const hasStroke = extent.inner > 0 || extent.outer > 0;
		if (hasStroke && distance >= -extent.inner - slack && distance <= extent.outer + slack) {
			return 'stroke';
		}
		if (isFrameLike(node) && distance <= 0) return 'area';
		return undefined;
	}

	private classifyLine(distance: number, slack: number, halfWeight: number): HitKind | undefined {
		if (halfWeight <= 0) return undefined;
		return distance <= halfWeight + slack ? 'stroke' : undefined;
	}

	private isMask(node: Node): boolean {
		return 'isMask' in node && node.isMask;
	}

	// ---------- clip and mask ----------

	private insideShape(node: Node, point: { x: number; y: number }): boolean {
		const space = this.localSpace(node.id, point);
		if (!space) return false;
		const distance = signedDistance(node, space.local.x, space.local.y);
		if (distance === undefined) return this.insideBounds(node.id, point);
		if (geometryKind(node) === 'line') return distance <= strokeExtent(node).outer;
		return distance <= 0;
	}

	private insideBounds(id: NodeId, point: { x: number; y: number }): boolean {
		const bounds = this.index.absoluteBounds(id);
		return (
			point.x >= bounds.x &&
			point.x <= bounds.x + bounds.width &&
			point.y >= bounds.y &&
			point.y <= bounds.y + bounds.height
		);
	}

	/** A child is hit only inside every clipping ancestor. */
	private insideClips(chain: Node[], point: { x: number; y: number }): boolean {
		for (const ancestor of chain.slice(1)) {
			if (ancestor.type === 'PAGE') continue;
			if (!('clipsContent' in ancestor) || !ancestor.clipsContent) continue;
			if (!this.insideShape(ancestor, point)) return false;
		}
		return true;
	}

	/**
	 * A mask clips the siblings above it (later in paint order). The nearest mask below a node
	 * applies; that holds for the node itself and for each ancestor, since a masked group is
	 * masked as a whole.
	 */
	private insideMasks(pageId: NodeId, chain: Node[], point: { x: number; y: number }): boolean {
		for (const node of chain) {
			if (node.type === 'PAGE' || node.parentId === null) continue;
			const mask = this.maskFor(pageId, node);
			if (mask && !this.insideShape(mask, point)) return false;
		}
		return true;
	}

	private maskFor(pageId: NodeId, node: Node): Node | undefined {
		if (node.parentId === null) return undefined;
		let nearest: Node | undefined;
		for (const maskId of this.index.masksIn(pageId, node.parentId)) {
			const mask = this.store.requireNode(maskId);
			if (mask.id === node.id || !(mask.index < node.index)) continue;
			if (mask.type !== 'PAGE' && !mask.visible) continue;
			if (nearest === undefined || mask.index > nearest.index) nearest = mask;
		}
		return nearest;
	}

	// ---------- paint order and scope ----------

	private paintKey(chain: Node[]): PaintKey {
		const key: PaintKey = [];
		for (let position = chain.length - 2; position >= 0; position -= 1) {
			key.push(chain[position].index);
		}
		return key;
	}

	/**
	 * The node a click on `chain[0]` selects given the scope, or undefined when the point is on
	 * the scope container's own background.
	 */
	private targetAtScope(
		chain: Node[],
		pageId: NodeId,
		scopeId: NodeId | null | undefined
	): Node | undefined {
		if (scopeId !== undefined && scopeId !== null && scopeId !== pageId) {
			const scopePosition = chain.findIndex((node) => node.id === scopeId);
			if (scopePosition === 0) return undefined;
			if (scopePosition > 0) return chain[scopePosition - 1];
			// Outside the scope: the scope resets to the page.
		}
		if (chain.length < 2) return undefined;
		const topLevel = chain[chain.length - 2];
		if (!this.isTransparentRoot(topLevel)) return topLevel;
		if (chain.length === 2) return undefined;
		// [K] children of a top-level frame are the first selectable level.
		return chain[chain.length - 3];
	}

	/** Top-level containers that select their children instead of themselves. */
	private isTransparentRoot(node: Node): boolean {
		return (
			node.type === 'FRAME' ||
			node.type === 'SECTION' ||
			node.type === 'COMPONENT' ||
			node.type === 'COMPONENT_SET'
		);
	}

	// ---------- frame titles ----------

	private hasTitle(node: Node): boolean {
		return this.isTransparentRoot(node) && node.type !== 'PAGE' && node.visible && !node.locked;
	}

	private titleContains(node: Node, point: { x: number; y: number }, zoom: number): boolean {
		if (node.type === 'PAGE') return false;
		const origin = transformPoint(this.index.absoluteTransform(node.id), 0, 0);
		const width = this.index.absoluteBounds(node.id).width;
		const labelWidth = (node.name.length * TITLE_CHARACTER_PIXELS + TITLE_PADDING_PIXELS) / zoom;
		const right = origin.x + Math.min(width, labelWidth);
		const top = origin.y - TITLE_HEIGHT_PIXELS / zoom;
		return point.x >= origin.x && point.x <= right && point.y >= top && point.y <= origin.y;
	}
}
