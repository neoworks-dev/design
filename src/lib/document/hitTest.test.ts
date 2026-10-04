import { describe, expect, it } from 'vitest';
import { buildDocument, frame, group, node, page, rectangle, type NodeSpec } from './fixtures';
import { HitTester } from './hitTest';
import { SceneIndex } from './sceneIndex';
import { DocumentStore } from './store';
import type { Matrix2x3, Paint, Stroke } from './types';

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function rotation(degrees: number, x: number, y: number): Matrix2x3 {
	const radians = (degrees * Math.PI) / 180;
	return [
		[Math.cos(radians), -Math.sin(radians), x],
		[Math.sin(radians), Math.cos(radians), y]
	];
}

const BLACK: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 0, g: 0, b: 0 }
};

function stroke(weight: number, align: Stroke['align']): Stroke {
	return {
		paints: [BLACK],
		weight,
		align,
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

function setup(specs: NodeSpec[]): { tester: HitTester; pageId: string; store: DocumentStore } {
	const store = new DocumentStore(buildDocument([page('P', specs)]));
	const index = new SceneIndex(store);
	return { tester: new HitTester(store, index), pageId: store.pages()[0].id, store };
}

describe('exact geometry', () => {
	it('rectangle: inside hits, outside misses even within bounds of a rotated node', () => {
		const { tester, pageId } = setup([
			rectangle({
				id: 'R',
				width: 100,
				height: 100,
				fills: [BLACK],
				transform: rotation(45, 100, 0)
			})
		]);
		// Rotated 45 degrees about (100, 0): the diamond's centre is (100, 70.7).
		expect(tester.deepest(pageId, { x: 100, y: 70 })).toBe('R');
		// Inside the axis-aligned bounds (x 29..171, y 0..141) but outside the diamond.
		expect(tester.deepest(pageId, { x: 40, y: 10 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 160, y: 130 })).toBeUndefined();
	});

	it('rounded rectangle: the corner is cut away', () => {
		const { tester, pageId } = setup([
			rectangle({ id: 'R', width: 100, height: 100, fills: [BLACK], cornerRadius: 40 })
		]);
		expect(tester.deepest(pageId, { x: 2, y: 2 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 12, y: 12 })).toBe('R');
		expect(tester.deepest(pageId, { x: 50, y: 2 })).toBe('R');
	});

	it('per-corner radii cut only their corner', () => {
		const { tester, pageId } = setup([
			rectangle({
				id: 'R',
				width: 100,
				height: 100,
				fills: [BLACK],
				cornerRadius: [40, 0, 0, 0]
			})
		]);
		expect(tester.deepest(pageId, { x: 2, y: 2 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 98, y: 2 })).toBe('R');
		expect(tester.deepest(pageId, { x: 2, y: 98 })).toBe('R');
	});

	it('ellipse: the bounding box corners miss', () => {
		const { tester, pageId } = setup([
			node('ELLIPSE', { id: 'E', width: 100, height: 60, fills: [BLACK] })
		]);
		expect(tester.deepest(pageId, { x: 50, y: 30 })).toBe('E');
		expect(tester.deepest(pageId, { x: 3, y: 3 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 97, y: 57 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 98, y: 30 })).toBe('E');
	});

	it('shape without fill is only hit on its stroke', () => {
		const { tester, pageId } = setup([
			rectangle({ id: 'R', width: 100, height: 100, fills: [], strokes: [stroke(10, 'CENTER')] })
		]);
		expect(tester.deepest(pageId, { x: 50, y: 50 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 50, y: 3 })).toBe('R');
		expect(tester.deepest(pageId, { x: 50, y: -4 })).toBe('R');
		expect(tester.deepest(pageId, { x: 50, y: -8 })).toBeUndefined();
	});

	it('stroke alignment decides where the stroke is', () => {
		const { tester, pageId } = setup([
			rectangle({ id: 'IN', width: 100, height: 100, fills: [], strokes: [stroke(10, 'INSIDE')] }),
			rectangle({
				id: 'OUT',
				transform: translation(300, 0),
				width: 100,
				height: 100,
				fills: [],
				strokes: [stroke(10, 'OUTSIDE')]
			})
		]);
		expect(tester.deepest(pageId, { x: 50, y: 5 })).toBe('IN');
		expect(tester.deepest(pageId, { x: 50, y: -5 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 350, y: -5 })).toBe('OUT');
		expect(tester.deepest(pageId, { x: 350, y: 5 })).toBeUndefined();
	});

	it('line: hit by distance to the segment, tolerance widens it', () => {
		const { tester, pageId } = setup([
			node('LINE', {
				id: 'L',
				width: 100,
				height: 0,
				strokes: [stroke(2, 'CENTER')],
				transform: rotation(90, 50, 0)
			})
		]);
		// Vertical line at x = 50 from y = 0 to 100.
		expect(tester.deepest(pageId, { x: 50.5, y: 50 })).toBe('L');
		expect(tester.deepest(pageId, { x: 53, y: 50 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 53, y: 50 }, { tolerance: 3 })).toBe('L');
		expect(tester.deepest(pageId, { x: 50, y: 120 })).toBeUndefined();
	});

	it('text and vectors use their bounds until their geometry exists', () => {
		const { tester, pageId } = setup([node('TEXT', { id: 'T', width: 80, height: 20 })]);
		expect(tester.deepest(pageId, { x: 79, y: 19 })).toBe('T');
		expect(tester.deepest(pageId, { x: 81, y: 19 })).toBeUndefined();
	});
});

describe('visibility and locking', () => {
	it('never returns hidden or locked nodes, nor their descendants', () => {
		const { tester, pageId } = setup([
			rectangle({ id: 'hidden', width: 50, height: 50, fills: [BLACK], visible: false }),
			rectangle({
				id: 'locked',
				transform: translation(100, 0),
				width: 50,
				height: 50,
				fills: [BLACK],
				locked: true
			}),
			group(
				{ id: 'lockedGroup', locked: true, transform: translation(200, 0), width: 50, height: 50 },
				[rectangle({ id: 'child', width: 50, height: 50, fills: [BLACK] })]
			),
			rectangle({
				id: 'plain',
				transform: translation(300, 0),
				width: 50,
				height: 50,
				fills: [BLACK]
			})
		]);
		for (const point of [
			{ x: 10, y: 10 },
			{ x: 110, y: 10 },
			{ x: 210, y: 10 }
		]) {
			expect(tester.all(pageId, point)).toEqual([]);
			expect(tester.topAtScope(pageId, point)).toBeUndefined();
			expect(tester.deepest(pageId, point)).toBeUndefined();
		}
		expect(tester.deepest(pageId, { x: 310, y: 10 })).toBe('plain');
	});
});

describe('clip and masks', () => {
	it('a child is only hit inside clipping ancestors', () => {
		const { tester, pageId } = setup([
			frame({ id: 'F', width: 100, height: 100, clipsContent: true }, [
				rectangle({
					id: 'wide',
					transform: translation(50, 0),
					width: 200,
					height: 50,
					fills: [BLACK]
				})
			]),
			frame(
				{ id: 'U', transform: translation(0, 300), width: 100, height: 100, clipsContent: false },
				[
					rectangle({
						id: 'wideU',
						transform: translation(50, 0),
						width: 200,
						height: 50,
						fills: [BLACK]
					})
				]
			)
		]);
		expect(tester.deepest(pageId, { x: 75, y: 10 })).toBe('wide');
		expect(tester.deepest(pageId, { x: 200, y: 10 })).toBeUndefined();
		expect(tester.deepest(pageId, { x: 200, y: 310 })).toBe('wideU');
	});

	it('clipping follows the ancestor shape, including rounded corners', () => {
		const { tester, pageId } = setup([
			frame({ id: 'F', width: 100, height: 100, clipsContent: true, cornerRadius: 50 }, [
				rectangle({ id: 'fill', width: 100, height: 100, fills: [BLACK] })
			])
		]);
		expect(tester.deepest(pageId, { x: 50, y: 50 })).toBe('fill');
		expect(tester.deepest(pageId, { x: 3, y: 3 })).toBeUndefined();
	});

	it('a mask clips the siblings above it, not the ones below', () => {
		const { tester, pageId } = setup([
			frame({ id: 'F', width: 200, height: 100, clipsContent: false }, [
				rectangle({ id: 'below', width: 200, height: 100, fills: [BLACK] }),
				node('ELLIPSE', { id: 'mask', width: 100, height: 100, isMask: true, fills: [BLACK] }),
				rectangle({ id: 'above', width: 200, height: 100, fills: [BLACK] })
			])
		]);
		// Inside the ellipse: the masked sibling is on top.
		expect(tester.deepest(pageId, { x: 50, y: 50 })).toBe('above');
		// Outside the ellipse the masked sibling is cut away; the one below is untouched.
		expect(tester.deepest(pageId, { x: 150, y: 50 })).toBe('below');
		// Ellipse corner: outside the mask shape.
		expect(tester.all(pageId, { x: 3, y: 3 })).toEqual(['below', 'F']);
	});

	it('a masked group is masked as a whole', () => {
		const { tester, pageId } = setup([
			frame({ id: 'F', width: 200, height: 100, clipsContent: false }, [
				rectangle({ id: 'mask', width: 50, height: 100, isMask: true, fills: [BLACK] }),
				group({ id: 'G', width: 200, height: 100 }, [
					rectangle({ id: 'inner', width: 200, height: 100, fills: [BLACK] })
				])
			])
		]);
		expect(tester.deepest(pageId, { x: 25, y: 50 })).toBe('inner');
		expect(tester.all(pageId, { x: 150, y: 50 })).toEqual(['F']);
	});
});

describe('result variants', () => {
	// F top-level frame (filled) > G group > R1, R2 (R2 above R1) ; nested frame N > R3 ; loose rect L
	function scene(): ReturnType<typeof setup> {
		return setup([
			frame({ id: 'F', width: 400, height: 400, fills: [BLACK] }, [
				group({ id: 'G', width: 100, height: 100 }, [
					rectangle({ id: 'R1', width: 100, height: 100, fills: [BLACK] }),
					rectangle({
						id: 'R2',
						transform: translation(50, 50),
						width: 100,
						height: 100,
						fills: [BLACK]
					})
				]),
				frame(
					{ id: 'N', transform: translation(200, 0), width: 150, height: 150, fills: [BLACK] },
					[rectangle({ id: 'R3', width: 50, height: 50, fills: [BLACK] })]
				)
			]),
			rectangle({ id: 'L', transform: translation(600, 0), width: 50, height: 50, fills: [BLACK] })
		]);
	}

	it('all lists every layer under the cursor topmost first', () => {
		const { tester, pageId } = scene();
		expect(tester.all(pageId, { x: 75, y: 75 })).toEqual(['R2', 'R1', 'F']);
	});

	it('deepest picks the topmost painted node', () => {
		const { tester, pageId } = scene();
		expect(tester.deepest(pageId, { x: 75, y: 75 })).toBe('R2');
		expect(tester.deepest(pageId, { x: 380, y: 300 })).toBe('F');
	});

	it('topAtScope: children of a top-level frame are the first level, groups are units', () => {
		const { tester, pageId } = scene();
		expect(tester.topAtScope(pageId, { x: 75, y: 75 })).toBe('G');
		expect(tester.topAtScope(pageId, { x: 210, y: 10 })).toBe('N');
		expect(tester.topAtScope(pageId, { x: 600 + 10, y: 10 })).toBe('L');
	});

	it('topAtScope: blank background of a filled top-level frame selects nothing', () => {
		const { tester, pageId } = scene();
		expect(tester.topAtScope(pageId, { x: 380, y: 300 })).toBeUndefined();
	});

	it('topAtScope with a group as scope selects its children; outside the scope resets it', () => {
		const { tester, pageId } = scene();
		expect(tester.topAtScope(pageId, { x: 75, y: 75 }, { scopeId: 'G' })).toBe('R2');
		expect(tester.topAtScope(pageId, { x: 10, y: 10 }, { scopeId: 'G' })).toBe('R1');
		// Scope G, click on N's child: G is not an ancestor, scope resets to the page rules.
		expect(tester.topAtScope(pageId, { x: 210, y: 10 }, { scopeId: 'G' })).toBe('N');
		// Scope N: its child is directly selectable.
		expect(tester.topAtScope(pageId, { x: 210, y: 10 }, { scopeId: 'N' })).toBe('R3');
	});

	it('an unfilled top-level frame is selected by its empty area or stroke, yielding to content', () => {
		const { tester, pageId } = setup([
			rectangle({
				id: 'below',
				transform: translation(300, 300),
				width: 50,
				height: 50,
				fills: [BLACK]
			}),
			frame({ id: 'E', width: 400, height: 400, fills: [] }, [
				rectangle({ id: 'inside', width: 50, height: 50, fills: [BLACK] })
			])
		]);
		expect(tester.topAtScope(pageId, { x: 200, y: 200 })).toBe('E');
		expect(tester.topAtScope(pageId, { x: 10, y: 10 })).toBe('inside');
		expect(tester.topAtScope(pageId, { x: 320, y: 320 })).toBe('below');
		expect(tester.deepest(pageId, { x: 200, y: 200 })).toBe('E');
	});

	it('frameTitle hits the label above a top-level frame', () => {
		const { tester, pageId } = setup([
			frame({
				id: 'F',
				name: 'Hero',
				transform: translation(100, 100),
				width: 300,
				height: 200,
				fills: [BLACK]
			})
		]);
		expect(tester.frameTitle(pageId, { x: 110, y: 90 }, { zoom: 1 })).toBe('F');
		expect(tester.frameTitle(pageId, { x: 110, y: 110 }, { zoom: 1 })).toBeUndefined();
		// Far to the right of a short name.
		expect(tester.frameTitle(pageId, { x: 380, y: 90 }, { zoom: 1 })).toBeUndefined();
		// The label height is in screen pixels: at 0.5 zoom it reaches 48 page units up.
		expect(tester.frameTitle(pageId, { x: 110, y: 60 }, { zoom: 0.5 })).toBe('F');
	});
});

describe('10k nodes', () => {
	function branch(depth: number, seed: number): NodeSpec {
		const transform = translation((seed * 37) % 600, (seed * 53) % 600);
		if (depth === 0) return rectangle({ transform, width: 20, height: 20, fills: [BLACK] });
		const children: NodeSpec[] = [];
		for (let child = 0; child < 5; child += 1)
			children.push(branch(depth - 1, seed * 7 + child + 1));
		return frame(
			{ transform, width: 700, height: 700, fills: [BLACK], clipsContent: false },
			children
		);
	}

	it('hit tests in under a millisecond on average', () => {
		const topLevel: NodeSpec[] = [];
		for (let top = 0; top < 13; top += 1) topLevel.push(branch(4, top + 1));
		const store = new DocumentStore(buildDocument([page('Big', topLevel)]));
		const index = new SceneIndex(store);
		const tester = new HitTester(store, index);
		const pageId = store.pages()[0].id;
		const buildStarted = performance.now();
		index.visible(pageId, { x: 0, y: 0, width: 1, height: 1 });
		const buildMs = performance.now() - buildStarted;
		const rounds = 300;
		const started = performance.now();
		for (let round = 0; round < rounds; round += 1) {
			tester.topAtScope(
				pageId,
				{ x: (round * 31) % 1300, y: (round * 17) % 1300 },
				{ tolerance: 2 }
			);
		}
		const perHit = (performance.now() - started) / rounds;
		process.stdout.write(
			`10k nodes (${Object.keys(store.nodes).length}): index build ${buildMs.toFixed(1)} ms, hit test ${perHit.toFixed(3)} ms\n`
		);
		expect(perHit).toBeLessThan(1);
	});
});
