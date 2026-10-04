import { describe, expect, it } from 'vitest';
import { toDocumentChanges } from './changeEvents';
import { buildDocument, frame, page, rectangle, type NodeSpec } from './fixtures';
import { RTree, boxOfRect } from './rtree';
import { SceneIndex } from './sceneIndex';
import { DocumentStore } from './store';
import type { Change, Matrix2x3, NodeId, Rect } from './types';

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function rotation(degrees: number, x: number, y: number): Matrix2x3 {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return [
		[cos, -sin, x],
		[sin, cos, y]
	];
}

/** Deterministic pseudo random numbers in [0, 1). */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function commit(store: DocumentStore, index: SceneIndex, changes: Change[]): void {
	store.applyAll(changes);
	index.handleChange({
		changes: toDocumentChanges(
			changes,
			changes.map(() => false),
			'user'
		)
	});
}

function setTransform(store: DocumentStore, id: NodeId, transform: Matrix2x3): Change {
	const node = store.requireNode(id);
	if (node.type === 'PAGE') throw new Error('page');
	return { t: 'set', id, set: { transform }, prev: { transform: node.transform } };
}

function sorted(ids: NodeId[]): NodeId[] {
	return [...ids].sort();
}

function intersects(first: Rect, second: Rect): boolean {
	return (
		first.x <= second.x + second.width &&
		first.x + first.width >= second.x &&
		first.y <= second.y + second.height &&
		first.y + first.height >= second.y
	);
}

function bruteForce(store: DocumentStore, pageId: NodeId, query: Rect): NodeId[] {
	// A fresh store has a cold cache, so this is the uncached definition of the bounds.
	const fresh = new DocumentStore(structuredClone(store.document));
	const reference = new SceneIndex(fresh);
	return fresh
		.descendants(pageId)
		.filter((node) => intersects(reference.renderBounds(node.id), query))
		.map((node) => node.id);
}

function randomScene(next: () => number): NodeSpec[] {
	const spec = (depth: number): NodeSpec => {
		const transform =
			next() < 0.3
				? rotation(next() * 90, next() * 400, next() * 400)
				: translation(next() * 400, next() * 400);
		const size = { width: 5 + next() * 120, height: 5 + next() * 120 };
		if (depth === 0) return rectangle({ transform, ...size });
		const children: NodeSpec[] = [];
		const count = 2 + Math.floor(next() * 3);
		for (let child = 0; child < count; child += 1) children.push(spec(depth - 1));
		return frame({ transform, ...size }, children);
	};
	return [spec(3), spec(2), spec(3)];
}

describe('RTree', () => {
	it('answers like a linear scan after bulk load, inserts and removals', () => {
		const next = random(7);
		const tree = new RTree();
		const boxes = new Map<NodeId, ReturnType<typeof boxOfRect>>();
		const items = [];
		for (let position = 0; position < 400; position += 1) {
			const box = boxOfRect({
				x: next() * 1000,
				y: next() * 1000,
				width: next() * 60,
				height: next() * 60
			});
			boxes.set(`b${position}`, box);
			items.push({ id: `b${position}`, box });
		}
		tree.load(items);
		for (let position = 400; position < 600; position += 1) {
			const box = boxOfRect({
				x: next() * 1000,
				y: next() * 1000,
				width: next() * 60,
				height: next() * 60
			});
			boxes.set(`b${position}`, box);
			tree.insert(`b${position}`, box);
		}
		for (let position = 0; position < 600; position += 3) {
			tree.remove(`b${position}`);
			boxes.delete(`b${position}`);
		}
		expect(tree.size).toBe(boxes.size);
		for (let round = 0; round < 50; round += 1) {
			const query = boxOfRect({
				x: next() * 1000,
				y: next() * 1000,
				width: next() * 200,
				height: next() * 200
			});
			const found: NodeId[] = [];
			tree.search(query, (id) => void found.push(id));
			const expected = [...boxes.entries()]
				.filter(
					([, box]) =>
						box.minX <= query.maxX &&
						box.maxX >= query.minX &&
						box.minY <= query.maxY &&
						box.maxY >= query.minY
				)
				.map(([id]) => id);
			expect(sorted(found)).toEqual(sorted(expected));
		}
	});

	it('empties and refills cleanly', () => {
		const tree = new RTree();
		tree.insert('a', boxOfRect({ x: 0, y: 0, width: 1, height: 1 }));
		tree.remove('a');
		expect(tree.size).toBe(0);
		tree.insert('b', boxOfRect({ x: 5, y: 5, width: 1, height: 1 }));
		const found: NodeId[] = [];
		tree.search(boxOfRect({ x: 0, y: 0, width: 10, height: 10 }), (id) => void found.push(id));
		expect(found).toEqual(['b']);
	});
});

describe('SceneIndex', () => {
	it('equals brute force on random trees through random edits (property test)', () => {
		for (const seed of [1, 2, 3]) {
			const next = random(seed);
			const store = new DocumentStore(buildDocument([page('P', randomScene(next))]));
			const index = new SceneIndex(store);
			const pageId = store.pages()[0].id;
			const check = (): void => {
				for (let round = 0; round < 15; round += 1) {
					const query = {
						x: next() * 500,
						y: next() * 500,
						width: next() * 150,
						height: next() * 150
					};
					expect(sorted(index.inRect(pageId, query))).toEqual(
						sorted(bruteForce(store, pageId, query))
					);
				}
			};
			check();
			for (let edit = 0; edit < 25; edit += 1) {
				const nodes = store.descendants(pageId);
				const target = nodes[Math.floor(next() * nodes.length)];
				const changes: Change[] = [];
				if (edit % 3 === 0) {
					changes.push({
						t: 'set',
						id: target.id,
						set: { width: 5 + next() * 100 },
						prev: { width: 'width' in target ? target.width : 0 }
					});
				} else {
					changes.push(setTransform(store, target.id, translation(next() * 400, next() * 400)));
				}
				commit(store, index, changes);
				check();
			}
		}
	});

	it('follows creates, reparenting and deletes', () => {
		const store = new DocumentStore(
			buildDocument([
				page('P', [
					frame({ id: 'A', width: 100, height: 100 }, [
						rectangle({ id: 'R', width: 10, height: 10 })
					]),
					frame({ id: 'B', transform: translation(500, 0), width: 100, height: 100 })
				])
			])
		);
		const index = new SceneIndex(store);
		const pageId = store.pages()[0].id;
		expect(index.atPoint(pageId, { x: 5, y: 5 })).toContain('R');
		commit(store, index, [
			{
				t: 'move',
				id: 'R',
				parent: 'B',
				index: 'a0',
				prevParent: 'A',
				prevIndex: store.requireNode('R').index
			}
		]);
		expect(index.atPoint(pageId, { x: 505, y: 5 })).toContain('R');
		expect(index.atPoint(pageId, { x: 5, y: 5 })).not.toContain('R');
		commit(store, index, [{ t: 'del', node: store.requireNode('R') }]);
		expect(index.atPoint(pageId, { x: 505, y: 5 })).not.toContain('R');
		expect(index.has('R')).toBe(false);
	});

	it('moving a frame recomputes each descendant once', () => {
		const store = new DocumentStore(
			buildDocument([
				page('P', [
					frame({ id: 'F', width: 200, height: 200 }, [
						rectangle({ id: 'R1', width: 10, height: 10 }),
						frame({ id: 'G', width: 50, height: 50 }, [
							rectangle({ id: 'R2', width: 5, height: 5 })
						])
					])
				])
			])
		);
		const index = new SceneIndex(store);
		const pageId = store.pages()[0].id;
		index.visible(pageId, { x: 0, y: 0, width: 1, height: 1 });
		const indexedBefore = index.reindexCount;
		const transformsBefore = store.cache.computeCount;
		commit(store, index, [setTransform(store, 'F', translation(300, 300))]);
		expect(index.reindexCount - indexedBefore).toBe(4);
		expect(store.cache.computeCount - transformsBefore).toBe(4);
		expect(index.atPoint(pageId, { x: 305, y: 305 }, 0, 'box')).toEqual(
			expect.arrayContaining(['F', 'R1'])
		);
	});

	it('a resize touches only that node', () => {
		const store = new DocumentStore(
			buildDocument([
				page('P', [
					frame({ id: 'F', width: 100, height: 100 }, [
						rectangle({ id: 'R', width: 10, height: 10 })
					])
				])
			])
		);
		const index = new SceneIndex(store);
		const pageId = store.pages()[0].id;
		index.visible(pageId, { x: 0, y: 0, width: 1, height: 1 });
		const before = index.reindexCount;
		commit(store, index, [{ t: 'set', id: 'R', set: { width: 40 }, prev: { width: 10 } }]);
		expect(index.reindexCount - before).toBe(1);
		expect(index.absoluteBounds('R').width).toBe(40);
	});

	it('render bounds include outside strokes and shadows, box bounds do not', () => {
		const store = new DocumentStore(
			buildDocument([
				page('P', [
					rectangle({
						id: 'S',
						width: 100,
						height: 100,
						strokes: [
							{
								paints: [
									{
										type: 'SOLID',
										visible: true,
										opacity: 1,
										blendMode: 'NORMAL',
										color: { r: 0, g: 0, b: 0 }
									}
								],
								weight: 10,
								align: 'OUTSIDE',
								cap: 'NONE',
								join: 'MITER',
								miterLimit: 4,
								dashPattern: []
							}
						]
					})
				])
			])
		);
		const index = new SceneIndex(store);
		const pageId = store.pages()[0].id;
		expect(index.renderBounds('S')).toEqual({ x: -10, y: -10, width: 120, height: 120 });
		expect(index.atPoint(pageId, { x: -5, y: -5 }, 0, 'render')).toEqual(['S']);
		expect(index.atPoint(pageId, { x: -5, y: -5 }, 0, 'box')).toEqual([]);
	});

	it('reset rebuilds lazily and builds only queried pages', () => {
		const store = new DocumentStore(
			buildDocument([page('A', [rectangle({ id: 'RA' })]), page('B', [rectangle({ id: 'RB' })])])
		);
		const index = new SceneIndex(store);
		const [pageA, pageB] = store.pages();
		index.atPoint(pageA.id, { x: 1, y: 1 });
		expect(index.builtPageCount).toBe(1);
		index.atPoint(pageB.id, { x: 1, y: 1 });
		expect(index.builtPageCount).toBe(2);
		index.reset();
		expect(index.builtPageCount).toBe(0);
		expect(index.atPoint(pageA.id, { x: 1, y: 1 })).toEqual(['RA']);
	});
});
