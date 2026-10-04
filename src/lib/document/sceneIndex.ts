// Spatial index over the document's page-space bounds (#40). Pure: it reads a DocumentReader and is
// told about commits; it knows nothing about the kernel.
//
// Layers:
//   - absolute transforms and bounding boxes: the store's DerivedCache (lazy, invalidated by the
//     store itself on every set / move / delete), so this class never recomputes them by hand;
//   - render bounds: bounding box grown by outside strokes and effects (hover, culling);
//   - one R-tree per page over render bounds, built lazily on the first query of that page and then
//     updated incrementally from `document/change`. Pages overlap in world space, hence one each.
//
// Two bound kinds: `box` (the node's own rectangle, for selection) and `render` (what is painted).
// The tree stores render bounds (a superset of the box), `box` queries filter on top.

import { boxOfRect, boxesIntersect, RTree, type Box } from './rtree';
import { effectOutset, strokeExtent } from './shapeGeometry';
import type { DocumentReader } from './store';
import type { DocumentChange, DocumentChangeEvent } from './changeEvents';
import { transformPoint } from './matrix';
import type { Matrix2x3, Node, NodeId, Rect } from './types';

export type BoundsKind = 'box' | 'render';

interface Entry {
	id: NodeId;
	pageId: NodeId;
	parentId: NodeId | null;
	isMask: boolean;
	box: Box;
	renderBox: Box;
}

interface PageIndex {
	tree: RTree;
	/** Mask nodes by parent, to find the mask that clips a node without scanning siblings. */
	masks: Map<NodeId, Set<NodeId>>;
}

const TRANSFORM_KEYS = ['transform', 'parentId', 'index'];

function rectOfBox(box: Box): Rect {
	return { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

function transformedRectBox(matrix: Matrix2x3, rect: Rect): Box {
	const corners = [
		transformPoint(matrix, rect.x, rect.y),
		transformPoint(matrix, rect.x + rect.width, rect.y),
		transformPoint(matrix, rect.x, rect.y + rect.height),
		transformPoint(matrix, rect.x + rect.width, rect.y + rect.height)
	];
	const xs = corners.map((corner) => corner.x);
	const ys = corners.map((corner) => corner.y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys)
	};
}

function inflate(box: Box, amount: number): Box {
	return {
		minX: box.minX - amount,
		minY: box.minY - amount,
		maxX: box.maxX + amount,
		maxY: box.maxY + amount
	};
}

export class SceneIndex {
	private readonly pages = new Map<NodeId, PageIndex>();
	private readonly entries = new Map<NodeId, Entry>();
	/** Number of node entries (re)computed since construction; tests assert "once" with it. */
	reindexCount = 0;

	constructor(private readonly store: DocumentReader) {}

	// ---------- cached geometry ----------

	absoluteTransform(id: NodeId): Matrix2x3 {
		return this.store.cache.absoluteTransform(id);
	}

	/** Axis-aligned bounding box in page space (the node's own rectangle, transformed). */
	absoluteBounds(id: NodeId): Rect {
		return this.store.cache.absoluteBounds(id);
	}

	/** Bounding box grown by outside strokes and effect reach. */
	renderBounds(id: NodeId): Rect {
		return rectOfBox(this.computeRenderBox(this.store.requireNode(id)));
	}

	// ---------- queries ----------

	/** Node ids (any order) whose bounds are within `tolerance` of `point`. */
	atPoint(
		pageId: NodeId,
		point: { x: number; y: number },
		tolerance = 0,
		kind: BoundsKind = 'render'
	): NodeId[] {
		const query = {
			minX: point.x - tolerance,
			minY: point.y - tolerance,
			maxX: point.x + tolerance,
			maxY: point.y + tolerance
		};
		return this.collect(pageId, query, kind);
	}

	/** Node ids whose bounds intersect `rect`; with `contained`, only those fully inside it. */
	inRect(
		pageId: NodeId,
		rect: Rect,
		options: { kind?: BoundsKind; contained?: boolean } = {}
	): NodeId[] {
		const kind = options.kind ?? 'render';
		const query = boxOfRect(rect);
		const ids = this.collect(pageId, query, kind);
		if (!options.contained) return ids;
		return ids.filter((id) => this.isInside(id, query, kind));
	}

	/** What a viewport showing `viewportRect` has to draw: render bounds intersecting it. */
	visible(pageId: NodeId, viewportRect: Rect): NodeId[] {
		return this.collect(pageId, boxOfRect(viewportRect), 'render');
	}

	/** Mask nodes that are children of `parentId`, in no particular order. */
	masksIn(pageId: NodeId, parentId: NodeId): readonly NodeId[] {
		const page = this.pageIndex(pageId);
		const masks = page.masks.get(parentId);
		if (!masks) return [];
		return [...masks];
	}

	has(id: NodeId): boolean {
		return this.entries.has(id);
	}

	/** Pages whose tree has been built. */
	get builtPageCount(): number {
		return this.pages.size;
	}

	// ---------- invalidation ----------

	/** Drops everything; the next query rebuilds lazily. For `document/replace`. */
	reset(): void {
		this.pages.clear();
		this.entries.clear();
		this.store.cache.invalidateAll();
	}

	/** Brings the built pages in line with one committed transaction. */
	handleChange(event: Pick<DocumentChangeEvent, 'changes'>): void {
		if (this.pages.size === 0) return;
		const subtreeRoots = new Set<NodeId>();
		const singles = new Set<NodeId>();
		for (const change of event.changes) this.classify(change, subtreeRoots, singles);
		for (const root of this.outermost(subtreeRoots)) this.reindexSubtree(root);
		for (const id of singles) this.reindexNode(id);
	}

	// ---------- internals ----------

	private classify(change: DocumentChange, subtreeRoots: Set<NodeId>, singles: Set<NodeId>): void {
		if (change.type === 'DELETE') {
			this.unindex(change.id);
			this.dropPageIfDeleted(change.id);
			return;
		}
		if (change.type === 'CREATE') {
			singles.add(change.id);
			return;
		}
		if (change.type !== 'PROPERTY_CHANGE') return;
		if (change.properties.some((key) => TRANSFORM_KEYS.includes(key))) {
			subtreeRoots.add(change.id);
			return;
		}
		singles.add(change.id);
	}

	private dropPageIfDeleted(id: NodeId): void {
		this.pages.delete(id);
	}

	/** Roots that are not below another root, so a subtree is walked once. */
	private outermost(roots: Set<NodeId>): NodeId[] {
		const result: NodeId[] = [];
		for (const root of roots) {
			if (!this.store.hasNode(root)) continue;
			if (!this.hasAncestorIn(root, roots)) result.push(root);
		}
		return result;
	}

	private hasAncestorIn(id: NodeId, roots: Set<NodeId>): boolean {
		let parentId = this.store.requireNode(id).parentId;
		while (parentId !== null) {
			if (roots.has(parentId)) return true;
			parentId = this.store.requireNode(parentId).parentId;
		}
		return false;
	}

	private reindexSubtree(rootId: NodeId): void {
		this.reindexNode(rootId);
		for (const descendant of this.store.descendants(rootId)) this.reindexNode(descendant.id);
	}

	private reindexNode(id: NodeId): void {
		this.unindex(id);
		if (!this.store.hasNode(id)) return;
		const node = this.store.requireNode(id);
		if (node.type === 'PAGE') return;
		const pageId = this.store.pageOf(id).id;
		if (!this.pages.has(pageId)) return;
		this.index(node, pageId);
	}

	private index(node: Node, pageId: NodeId): void {
		const entry = this.makeEntry(node, pageId);
		this.entries.set(node.id, entry);
		const page = this.requirePage(pageId);
		page.tree.insert(node.id, entry.renderBox);
		this.addMask(page, entry);
	}

	private unindex(id: NodeId): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		const page = this.pages.get(entry.pageId);
		if (!page) return;
		page.tree.remove(id);
		this.removeMask(page, entry);
	}

	private addMask(page: PageIndex, entry: Entry): void {
		if (!entry.isMask || entry.parentId === null) return;
		let masks = page.masks.get(entry.parentId);
		if (!masks) {
			masks = new Set();
			page.masks.set(entry.parentId, masks);
		}
		masks.add(entry.id);
	}

	private removeMask(page: PageIndex, entry: Entry): void {
		if (!entry.isMask || entry.parentId === null) return;
		page.masks.get(entry.parentId)?.delete(entry.id);
	}

	private makeEntry(node: Node, pageId: NodeId): Entry {
		this.reindexCount += 1;
		const renderBox = this.computeRenderBox(node);
		const isMask = 'isMask' in node && node.isMask;
		return {
			id: node.id,
			pageId,
			parentId: node.parentId,
			isMask,
			box: boxOfRect(this.absoluteBounds(node.id)),
			renderBox
		};
	}

	private computeRenderBox(node: Node): Box {
		if (node.type === 'PAGE') throw new Error('pages have no bounds');
		const reach = strokeExtent(node).outer;
		const local = {
			x: -reach,
			y: -reach,
			width: node.width + 2 * reach,
			height: node.height + 2 * reach
		};
		const box = transformedRectBox(this.absoluteTransform(node.id), local);
		return inflate(box, effectOutset(node));
	}

	private pageIndex(pageId: NodeId): PageIndex {
		const existing = this.pages.get(pageId);
		if (existing) return existing;
		return this.buildPage(pageId);
	}

	private requirePage(pageId: NodeId): PageIndex {
		const page = this.pages.get(pageId);
		if (!page) throw new Error(`page not built: ${pageId}`);
		return page;
	}

	private buildPage(pageId: NodeId): PageIndex {
		const page: PageIndex = { tree: new RTree(), masks: new Map() };
		this.pages.set(pageId, page);
		const items: { id: NodeId; box: Box }[] = [];
		for (const node of this.store.descendants(pageId)) {
			const entry = this.makeEntry(node, pageId);
			this.entries.set(node.id, entry);
			this.addMask(page, entry);
			items.push({ id: node.id, box: entry.renderBox });
		}
		page.tree.load(items);
		return page;
	}

	private collect(pageId: NodeId, query: Box, kind: BoundsKind): NodeId[] {
		const page = this.pageIndex(pageId);
		const found: NodeId[] = [];
		page.tree.search(query, (id) => {
			if (kind === 'box' && !this.boxHits(id, query)) return;
			found.push(id);
		});
		return found;
	}

	private boxHits(id: NodeId, query: Box): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		return boxesIntersect(entry.box, query);
	}

	private isInside(id: NodeId, query: Box, kind: BoundsKind): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		const box = kind === 'box' ? entry.box : entry.renderBox;
		return (
			query.minX <= box.minX &&
			query.maxX >= box.maxX &&
			query.minY <= box.minY &&
			query.maxY >= box.maxY
		);
	}
}
