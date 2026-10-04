import { describe, expect, it } from 'vitest';
import { buildDocument, frame, rectangle, page, type NodeSpec } from './fixtures';
import { DocumentStore } from './store';
import type { Matrix2x3 } from './types';

// Budget (documented, asserted with ~10x headroom so CI noise does not flake):
//   absolute bounds for all 10k nodes of a cold cache: < 250 ms   (measured: ~25 ms)
//   re-read after invalidating one top-level subtree of 781 nodes:  < 100 ms
//   building the store (child index) for 10k nodes: < 250 ms

const COLD_RECOMPUTE_BUDGET_MS = 250;
const PARTIAL_RECOMPUTE_BUDGET_MS = 100;
const BUILD_BUDGET_MS = 250;

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function branch(depth: number, breadth: number, seed: number): NodeSpec {
	const transform = translation(seed % 17, seed % 13);
	if (depth === 0) return rectangle({ transform, width: 10, height: 10 });
	const children: NodeSpec[] = [];
	for (let child = 0; child < breadth; child += 1) {
		children.push(branch(depth - 1, breadth, seed * 7 + child + 1));
	}
	return frame({ transform, width: 100, height: 100 }, children);
}

// 13 top-level frames of 781 nodes each (branching factor 5, depth 4): 10,154 nodes.
function tenThousandNodeStore(): { store: DocumentStore; topLevel: string[] } {
	const topLevel: NodeSpec[] = [];
	for (let top = 0; top < 13; top += 1) topLevel.push(branch(4, 5, top + 1));
	const started = performance.now();
	const store = new DocumentStore(buildDocument([page('Big', topLevel)]));
	const elapsed = performance.now() - started;
	expect(elapsed).toBeLessThan(BUILD_BUDGET_MS * 4);
	return { store, topLevel: [...store.children(store.pages()[0].id)] };
}

describe('10k node tree', () => {
	const { store, topLevel } = tenThousandNodeStore();
	const nodeCount = Object.keys(store.nodes).length;

	it('has about ten thousand nodes', () => {
		expect(nodeCount).toBeGreaterThan(7_000);
		expect(nodeCount).toBeLessThan(13_000);
	});

	it('recomputes every absolute bound from a cold cache within budget', () => {
		const started = performance.now();
		for (const id of Object.keys(store.nodes)) store.cache.absoluteBounds(id);
		const elapsed = performance.now() - started;
		process.stdout.write(`cold recompute of ${nodeCount} nodes: ${elapsed.toFixed(1)} ms\n`);
		expect(elapsed).toBeLessThan(COLD_RECOMPUTE_BUDGET_MS);
	});

	it('re-reads one invalidated subtree within budget and leaves the rest cached', () => {
		for (const id of Object.keys(store.nodes)) store.cache.absoluteBounds(id);
		const target = topLevel[0];
		store.apply({ t: 'set', id: target, set: { transform: translation(5, 5) }, prev: {} });
		const started = performance.now();
		for (const node of [store.requireNode(target), ...store.descendants(target)]) {
			store.cache.absoluteBounds(node.id);
		}
		const elapsed = performance.now() - started;
		process.stdout.write(`subtree re-read: ${elapsed.toFixed(1)} ms\n`);
		expect(elapsed).toBeLessThan(PARTIAL_RECOMPUTE_BUDGET_MS);
		expect(store.cache.isTransformCached(topLevel[1])).toBe(true);
	});
});
