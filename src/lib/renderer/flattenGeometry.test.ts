// Golden tests of Flatten and Outline stroke (issue #103): a shape is drawn, flattened (or its
// stroke outlined) through the planning code, drawn again, and the two images must agree within a
// tolerance. Real CanvasKit, headless.

import { beforeAll, describe, expect, it } from 'vitest';
import { group, node, page, rectangle, type NodeSpec } from '../document/fixtures';
import type { Matrix2x3, Paint, SceneNode, Stroke } from '../document/types';
import { applyTo, storeOf } from '../editing/fixtures/editingFixture';
import { planFlattenNode, planOutlineStroke, type StrokeArea } from '../editing/flatten';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { CanvasKitBackend } from './canvaskitBackend';
import { booleanNetwork, groupNetwork, shapeNetwork, strokeAreaNetwork } from './flattenGeometry';
import { SkiaTracker } from './ownership';
import { StoreSceneSource } from './storeSceneSource';
import { RenderSurface } from './surface';
import type { DocumentStore } from '../document/store';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

const SIZE = 200;

function at(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function solid(red: number, green: number, blue: number): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: red, g: green, b: blue }
	};
}

function stroke(
	weight: number,
	align: Stroke['align'],
	color: Paint,
	extra: Partial<Stroke> = {}
): Stroke {
	return {
		paints: [color],
		weight,
		align,
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: [],
		...extra
	};
}

function pixelsOf(store: DocumentStore): Uint8Array {
	const tracker = new SkiaTracker();
	const surface = RenderSurface.offscreen(canvasKit, tracker, SIZE, SIZE);
	const backend = new CanvasKitBackend(canvasKit, tracker, surface);
	backend.render({
		source: new StoreSceneSource(store.document, { pageId: 'p' }),
		view: { x: 0, y: 0, scale: 1 },
		size: { width: SIZE, height: SIZE },
		devicePixelRatio: 1
	});
	return surface.readPixels({ x: 0, y: 0, width: SIZE, height: SIZE });
}

/** Share of pixels whose colour differs by more than a rasteriser rounding error. */
function differingShare(before: Uint8Array, after: Uint8Array): number {
	let differing = 0;
	for (let index = 0; index < before.length; index += 4) {
		const difference = Math.max(
			Math.abs(before[index] - after[index]),
			Math.abs(before[index + 1] - after[index + 1]),
			Math.abs(before[index + 2] - after[index + 2])
		);
		if (difference > 40) differing += 1;
	}
	return differing / (before.length / 4);
}

/** Pixels that are not the page background: a render of nothing would trivially match. */
function inkOf(pixels: Uint8Array): number {
	let ink = 0;
	for (let index = 0; index < pixels.length; index += 4) {
		if (pixels[index] !== 245 || pixels[index + 1] !== 245) ink += 1;
	}
	return ink;
}

function sceneNode(store: DocumentStore, id: string): SceneNode {
	const found = store.requireNode(id);
	if (found.type === 'PAGE') throw new Error('not a scene node');
	return found;
}

function pageOf(spec: NodeSpec): DocumentStore {
	return storeOf([page('P', [spec], { id: 'p' })]);
}

const ID = 'shape';

function flattenedShare(spec: NodeSpec): number {
	const store = pageOf(spec);
	const before = pixelsOf(store);
	expect(inkOf(before)).toBeGreaterThan(200);
	const network = shapeNetwork(canvasKit, sceneNode(store, ID));
	if (!network) throw new Error('no network');
	const plan = planFlattenNode(store, ID, network);
	if (!plan) throw new Error('no plan');
	applyTo(store, plan.changes);
	expect(store.requireNode(plan.vectorId).type).toBe('VECTOR');
	expect(store.hasNode(ID)).toBe(false);
	return differingShare(before, pixelsOf(store));
}

describe('Flatten renders like the shape it replaces', () => {
	it.each([
		[
			'a rounded rectangle',
			rectangle({
				id: ID,
				transform: at(30, 40),
				width: 120,
				height: 80,
				cornerRadius: 18,
				fills: [solid(1, 0, 0)]
			})
		],
		[
			'an ellipse with an inside stroke',
			node('ELLIPSE', {
				id: ID,
				transform: at(30, 30),
				width: 140,
				height: 100,
				fills: [solid(0, 0.6, 0.2)],
				strokes: [stroke(10, 'INSIDE', solid(0, 0, 1))]
			})
		],
		[
			'a star with a centred stroke',
			node('STAR', {
				id: ID,
				transform: at(20, 20),
				width: 150,
				height: 150,
				pointCount: 5,
				innerRadius: 0.4,
				fills: [solid(1, 0.8, 0)],
				strokes: [stroke(6, 'CENTER', solid(0, 0, 0), { join: 'ROUND' })]
			})
		],
		[
			'an open line with round caps',
			node('LINE', {
				id: ID,
				transform: at(30, 100),
				width: 140,
				height: 0,
				strokes: [stroke(12, 'CENTER', solid(0.5, 0, 0.8), { cap: 'ROUND' })]
			})
		]
	])('%s', (_name, spec) => {
		expect(flattenedShare(spec)).toBeLessThan(0.005);
	});

	it('a group becomes the union of what it holds, with the fill of its topmost child', () => {
		const spec = group({ id: ID, transform: at(20, 20), width: 150, height: 120 }, [
			rectangle({ id: 'a', transform: at(0, 0), width: 90, height: 90, fills: [solid(0, 0.4, 1)] }),
			rectangle({
				id: 'b',
				transform: at(50, 30),
				width: 90,
				height: 90,
				fills: [solid(0, 0.4, 1)]
			})
		]);
		const store = pageOf(spec);
		const before = pixelsOf(store);
		const network = groupNetwork(canvasKit, store, sceneNode(store, ID));
		if (!network) throw new Error('no network');
		const plan = planFlattenNode(store, ID, network, [solid(0, 0.4, 1)]);
		if (!plan) throw new Error('no plan');
		applyTo(store, plan.changes);
		expect(store.hasNode('a')).toBe(false);
		expect(differingShare(before, pixelsOf(store))).toBeLessThan(0.005);
	});

	it('a boolean subtract keeps its hole', () => {
		const spec = node(
			'BOOLEAN_OPERATION',
			{
				id: ID,
				transform: at(20, 20),
				width: 120,
				height: 120,
				booleanOperation: 'SUBTRACT',
				fills: [solid(0.9, 0.1, 0.1)]
			},
			[
				rectangle({
					id: 'a',
					transform: at(0, 0),
					width: 120,
					height: 120,
					fills: [solid(0, 0, 0)]
				}),
				node('ELLIPSE', {
					id: 'b',
					transform: at(30, 30),
					width: 60,
					height: 60,
					fills: [solid(0, 0, 0)]
				})
			]
		);
		const store = pageOf(spec);
		const before = pixelsOf(store);
		const network = booleanNetwork(canvasKit, store, sceneNode(store, ID));
		if (!network) throw new Error('no network');
		const plan = planFlattenNode(store, ID, network);
		if (!plan) throw new Error('no plan');
		applyTo(store, plan.changes);
		const after = pixelsOf(store);
		expect(differingShare(before, after)).toBeLessThan(0.005);
		const centre = (50 + 20 + (50 + 20) * SIZE) * 4;
		expect([after[centre], after[centre + 1], after[centre + 2]]).toEqual([245, 245, 245]);
	});
});

function outlinedShare(spec: NodeSpec, strokes: Stroke[]): { share: number; vectors: number } {
	const store = pageOf(spec);
	const before = pixelsOf(store);
	expect(inkOf(before)).toBeGreaterThan(200);
	const areas: StrokeArea[] = [];
	for (const entry of strokes) {
		const network = strokeAreaNetwork(canvasKit, sceneNode(store, ID), entry);
		if (network) areas.push({ stroke: entry, network });
	}
	const plan = planOutlineStroke(store, ID, areas);
	if (!plan) throw new Error('no plan');
	applyTo(store, plan.changes);
	return { share: differingShare(before, pixelsOf(store)), vectors: plan.vectorIds.length };
}

describe('Outline stroke renders like the stroke it replaces', () => {
	it.each(['CENTER', 'INSIDE', 'OUTSIDE'] as const)('a %s stroke on a rectangle', (align) => {
		const strokes = [stroke(14, align, solid(0, 0, 1))];
		const spec = rectangle({
			id: ID,
			transform: at(40, 40),
			width: 110,
			height: 90,
			cornerRadius: 10,
			strokes
		});
		const { share, vectors } = outlinedShare(spec, strokes);
		expect(vectors).toBe(1);
		expect(share).toBeLessThan(0.005);
	});

	it('keeps the fill of the node and puts the stroke above it', () => {
		const strokes = [stroke(10, 'CENTER', solid(0, 0, 1))];
		const spec = rectangle({
			id: ID,
			transform: at(40, 40),
			width: 110,
			height: 90,
			fills: [solid(1, 0.8, 0.8)],
			strokes
		});
		const store = pageOf(spec);
		const before = pixelsOf(store);
		const network = strokeAreaNetwork(canvasKit, sceneNode(store, ID), strokes[0]);
		if (!network) throw new Error('no network');
		const plan = planOutlineStroke(store, ID, [{ stroke: strokes[0], network }]);
		if (!plan) throw new Error('no plan');
		applyTo(store, plan.changes);
		const original = store.requireNode(ID);
		expect('strokes' in original && original.strokes).toEqual([]);
		const order = store.childNodes('p').map((child) => child.id);
		expect(order).toEqual([ID, plan.vectorIds[0]]);
		expect(differingShare(before, pixelsOf(store))).toBeLessThan(0.005);
	});

	it('a dashed line keeps its gaps', () => {
		const strokes = [stroke(8, 'CENTER', solid(0, 0, 0), { dashPattern: [16, 12] })];
		const spec = node('LINE', { id: ID, transform: at(20, 100), width: 160, height: 0, strokes });
		const { share } = outlinedShare(spec, strokes);
		expect(share).toBeLessThan(0.01);
	});

	it('a node without strokes gives nothing to outline', () => {
		const store = pageOf(rectangle({ id: ID, width: 40, height: 40 }));
		expect(planOutlineStroke(store, ID, [])).toBeNull();
		expect(
			strokeAreaNetwork(canvasKit, sceneNode(store, ID), stroke(0, 'CENTER', solid(0, 0, 0)))
		).toBeNull();
	});
});
