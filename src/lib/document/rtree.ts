// Dynamic R-tree over axis-aligned boxes, keyed by id. Chosen over a uniform grid because design
// files mix page-sized frames with icon-sized shapes: a grid either splits the big ones across
// thousands of cells or makes small cells useless, while an R-tree adapts to both.
//
// Bulk `load` uses sort-tile-recursive packing (fast, tight); later `insert` / `remove` are
// incremental (least-enlargement descent, split by the longer axis). `remove` does not rebalance:
// underfull nodes are tolerated, empty ones are pruned.

import type { NodeId, Rect } from './types';

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function boxOfRect(rect: Rect): Box {
	return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
}

export function boxesIntersect(first: Box, second: Box): boolean {
	return (
		first.minX <= second.maxX &&
		first.maxX >= second.minX &&
		first.minY <= second.maxY &&
		first.maxY >= second.minY
	);
}

function boxContains(outer: Box, inner: Box): boolean {
	return (
		outer.minX <= inner.minX &&
		outer.maxX >= inner.maxX &&
		outer.minY <= inner.minY &&
		outer.maxY >= inner.maxY
	);
}

function unionBox(first: Box, second: Box): Box {
	return {
		minX: Math.min(first.minX, second.minX),
		minY: Math.min(first.minY, second.minY),
		maxX: Math.max(first.maxX, second.maxX),
		maxY: Math.max(first.maxY, second.maxY)
	};
}

function area(box: Box): number {
	return (box.maxX - box.minX) * (box.maxY - box.minY);
}

interface Item {
	id: NodeId;
	box: Box;
}

interface TreeNode {
	box: Box;
	parent: TreeNode | null;
	/** Leaves hold items, inner nodes hold nodes. */
	leaf: boolean;
	items: Item[];
	nodes: TreeNode[];
}

const MAX_ENTRIES = 16;

function emptyBox(): Box {
	return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function newNode(leaf: boolean): TreeNode {
	return { box: emptyBox(), parent: null, leaf, items: [], nodes: [] };
}

function recomputeBox(node: TreeNode): void {
	let box = emptyBox();
	if (node.leaf) {
		for (const item of node.items) box = unionBox(box, item.box);
	} else {
		for (const child of node.nodes) box = unionBox(box, child.box);
	}
	node.box = box;
}

export class RTree {
	private root: TreeNode = newNode(true);
	private readonly leafOf = new Map<NodeId, TreeNode>();

	get size(): number {
		return this.leafOf.size;
	}

	has(id: NodeId): boolean {
		return this.leafOf.has(id);
	}

	clear(): void {
		this.root = newNode(true);
		this.leafOf.clear();
	}

	/** Replaces the content with `items`, packed. */
	load(items: readonly Item[]): void {
		this.clear();
		if (items.length === 0) return;
		let level: TreeNode[] = this.packLeaves(items);
		while (level.length > 1) level = this.packLevel(level);
		this.root = level[0];
	}

	insert(id: NodeId, box: Box): void {
		if (this.leafOf.has(id)) this.remove(id);
		const leaf = this.chooseLeaf(box);
		leaf.items.push({ id, box });
		this.leafOf.set(id, leaf);
		this.growUp(leaf, box);
		this.splitUp(leaf);
	}

	remove(id: NodeId): boolean {
		const leaf = this.leafOf.get(id);
		if (!leaf) return false;
		this.leafOf.delete(id);
		leaf.items = leaf.items.filter((item) => item.id !== id);
		this.pruneUp(leaf);
		return true;
	}

	/** Visits ids whose box intersects `query`; the visitor returns false to stop early. */
	search(query: Box, visit: (id: NodeId, box: Box) => boolean | void): void {
		if (this.leafOf.size === 0) return;
		const pending: TreeNode[] = [this.root];
		while (pending.length > 0) {
			const node = pending.pop();
			if (!node || !boxesIntersect(node.box, query)) continue;
			if (!node.leaf) {
				pending.push(...node.nodes);
				continue;
			}
			for (const item of node.items) {
				if (!boxesIntersect(item.box, query)) continue;
				if (visit(item.id, item.box) === false) return;
			}
		}
	}

	/** Ids whose box lies fully inside `query`. */
	searchContained(query: Box): NodeId[] {
		const found: NodeId[] = [];
		this.search(query, (id, box) => {
			if (boxContains(query, box)) found.push(id);
		});
		return found;
	}

	private packLeaves(items: readonly Item[]): TreeNode[] {
		const sorted = [...items].sort((a, b) => a.box.minX + a.box.maxX - (b.box.minX + b.box.maxX));
		const leafCount = Math.ceil(sorted.length / MAX_ENTRIES);
		const columns = Math.ceil(Math.sqrt(leafCount));
		const columnSize = columns * MAX_ENTRIES;
		const leaves: TreeNode[] = [];
		for (let start = 0; start < sorted.length; start += columnSize) {
			const column = sorted
				.slice(start, start + columnSize)
				.sort((a, b) => a.box.minY + a.box.maxY - (b.box.minY + b.box.maxY));
			for (let offset = 0; offset < column.length; offset += MAX_ENTRIES) {
				const leaf = newNode(true);
				leaf.items = column.slice(offset, offset + MAX_ENTRIES);
				for (const item of leaf.items) this.leafOf.set(item.id, leaf);
				recomputeBox(leaf);
				leaves.push(leaf);
			}
		}
		return leaves;
	}

	private packLevel(children: TreeNode[]): TreeNode[] {
		const sorted = [...children].sort(
			(a, b) => a.box.minX + a.box.maxX - (b.box.minX + b.box.maxX)
		);
		const parents: TreeNode[] = [];
		const parentCount = Math.ceil(sorted.length / MAX_ENTRIES);
		const columns = Math.ceil(Math.sqrt(parentCount));
		const columnSize = columns * MAX_ENTRIES;
		for (let start = 0; start < sorted.length; start += columnSize) {
			const column = sorted
				.slice(start, start + columnSize)
				.sort((a, b) => a.box.minY + a.box.maxY - (b.box.minY + b.box.maxY));
			for (let offset = 0; offset < column.length; offset += MAX_ENTRIES) {
				const parent = newNode(false);
				parent.nodes = column.slice(offset, offset + MAX_ENTRIES);
				for (const child of parent.nodes) child.parent = parent;
				recomputeBox(parent);
				parents.push(parent);
			}
		}
		return parents;
	}

	private chooseLeaf(box: Box): TreeNode {
		let node = this.root;
		while (!node.leaf) {
			let best = node.nodes[0];
			let bestGrowth = Infinity;
			for (const child of node.nodes) {
				const growth = area(unionBox(child.box, box)) - area(child.box);
				const better =
					growth < bestGrowth || (growth === bestGrowth && area(child.box) < area(best.box));
				if (!better) continue;
				best = child;
				bestGrowth = growth;
			}
			node = best;
		}
		return node;
	}

	private growUp(start: TreeNode, box: Box): void {
		let node: TreeNode | null = start;
		while (node) {
			node.box = unionBox(node.box, box);
			node = node.parent;
		}
	}

	private splitUp(start: TreeNode): void {
		let node: TreeNode | null = start;
		while (node) {
			const count = node.leaf ? node.items.length : node.nodes.length;
			if (count <= MAX_ENTRIES) return;
			const sibling = this.split(node);
			if (node.parent === null) {
				const newRoot = newNode(false);
				newRoot.nodes = [node, sibling];
				node.parent = newRoot;
				sibling.parent = newRoot;
				recomputeBox(newRoot);
				this.root = newRoot;
				return;
			}
			sibling.parent = node.parent;
			node.parent.nodes.push(sibling);
			recomputeBox(node.parent);
			node = node.parent;
		}
	}

	/** Moves the upper half (along the longer axis) of `node` into a new sibling. */
	private split(node: TreeNode): TreeNode {
		const wide = node.box.maxX - node.box.minX >= node.box.maxY - node.box.minY;
		const centre = (box: Box): number => (wide ? box.minX + box.maxX : box.minY + box.maxY);
		const sibling = newNode(node.leaf);
		if (node.leaf) {
			node.items.sort((a, b) => centre(a.box) - centre(b.box));
			sibling.items = node.items.splice(Math.ceil(node.items.length / 2));
			for (const item of sibling.items) this.leafOf.set(item.id, sibling);
		} else {
			node.nodes.sort((a, b) => centre(a.box) - centre(b.box));
			sibling.nodes = node.nodes.splice(Math.ceil(node.nodes.length / 2));
			for (const child of sibling.nodes) child.parent = sibling;
		}
		recomputeBox(node);
		recomputeBox(sibling);
		return sibling;
	}

	private pruneUp(start: TreeNode): void {
		let node: TreeNode | null = start;
		while (node) {
			const empty = node.leaf ? node.items.length === 0 : node.nodes.length === 0;
			const parent: TreeNode | null = node.parent;
			if (empty && !parent) {
				this.root = newNode(true);
			} else if (empty && parent) {
				parent.nodes = parent.nodes.filter((child) => child !== node);
			} else {
				recomputeBox(node);
			}
			node = parent;
		}
	}
}
