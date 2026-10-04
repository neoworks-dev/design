// Derived-data cache: absolute transforms and bounds (data-model.md section 1: derived data is
// cache, never saved). Invalidated by the store when a change touches an input, recomputed lazily
// on the next read.
//
// Invariant: a node with a cached absolute transform has every ancestor cached too (a read caches
// the whole chain). So invalidating a subtree can stop at the first uncached node, and a read
// folds up only to the nearest cached ancestor.

import { composeMatrices, identityMatrix, transformedBounds } from './matrix';
import type { Matrix2x3, Node, NodeId, Rect } from './types';

export interface TreeAccess {
	getNode(id: NodeId): Node | undefined;
	children(parentId: NodeId | null): readonly NodeId[];
}

const TRANSFORM_KEYS = ['transform', 'parentId', 'index'];
const SIZE_KEYS = ['width', 'height'];

function sizeOf(node: Node): { width: number; height: number } {
	if (node.type === 'PAGE') return { width: 0, height: 0 };
	return { width: node.width, height: node.height };
}

export class DerivedCache {
	private readonly transforms = new Map<NodeId, Matrix2x3>();
	private readonly bounds = new Map<NodeId, Rect>();
	/** Number of absolute transforms computed so far; tests assert laziness with it. */
	computeCount = 0;

	constructor(private readonly tree: TreeAccess) {}

	absoluteTransform(id: NodeId): Matrix2x3 {
		const cached = this.transforms.get(id);
		if (cached) return cached;
		return this.computeTransformChain(id);
	}

	absoluteBounds(id: NodeId): Rect {
		const cached = this.bounds.get(id);
		if (cached) return cached;
		const node = this.requireNode(id);
		const { width, height } = sizeOf(node);
		const bounds = transformedBounds(this.absoluteTransform(id), width, height);
		this.bounds.set(id, bounds);
		return bounds;
	}

	isTransformCached(id: NodeId): boolean {
		return this.transforms.has(id);
	}

	isBoundsCached(id: NodeId): boolean {
		return this.bounds.has(id);
	}

	/** A node and everything below it lost its cached transform and bounds. */
	invalidateSubtree(id: NodeId): void {
		this.bounds.delete(id);
		if (!this.transforms.delete(id)) return;
		const pending: NodeId[] = [...this.tree.children(id)];
		while (pending.length > 0) {
			const current = pending.pop();
			if (current === undefined) break;
			this.bounds.delete(current);
			if (!this.transforms.delete(current)) continue;
			pending.push(...this.tree.children(current));
		}
	}

	invalidateAll(): void {
		this.transforms.clear();
		this.bounds.clear();
	}

	/** Called by the store before it applies a `set`, with the keys the change writes. */
	onSet(id: NodeId, keys: string[]): void {
		if (keys.some((key) => TRANSFORM_KEYS.includes(key))) {
			this.invalidateSubtree(id);
			return;
		}
		if (keys.some((key) => SIZE_KEYS.includes(key))) this.bounds.delete(id);
	}

	private computeTransformChain(id: NodeId): Matrix2x3 {
		const uncachedChain: Node[] = [];
		let current: Node | undefined = this.requireNode(id);
		let base: Matrix2x3 = identityMatrix();
		while (current) {
			const cached = this.transforms.get(current.id);
			if (cached) {
				base = cached;
				break;
			}
			uncachedChain.push(current);
			if (current.parentId === null) break;
			current = this.requireNode(current.parentId);
		}
		for (let position = uncachedChain.length - 1; position >= 0; position -= 1) {
			const node = uncachedChain[position];
			if (node.type !== 'PAGE') base = composeMatrices(base, node.transform);
			this.transforms.set(node.id, base);
			this.computeCount += 1;
		}
		return base;
	}

	private requireNode(id: NodeId): Node {
		const node = this.tree.getNode(id);
		if (!node) throw new Error(`node not found: ${id}`);
		return node;
	}
}
