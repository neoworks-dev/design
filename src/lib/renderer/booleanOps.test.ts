// Golden tests of boolean operations (issue #102): two overlapping squares through the real
// CanvasKit PathOps, drawn headlessly, with pixel probes well inside each region.

import { beforeAll, describe, expect, it } from 'vitest';
import { applyChanges, rollback } from '../document/apply';
import { planSetProps } from '../document/changes';
import { buildDocument, group, node, page, rectangle, type NodeSpec } from '../document/fixtures';
import type { BooleanOperationNode, Matrix2x3, Paint } from '../document/types';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { CanvasKitBackend } from './canvaskitBackend';
import { SkiaTracker } from './ownership';
import { StoreSceneSource } from './storeSceneSource';
import { RenderSurface } from './surface';
import { booleanResultPath, pathToCommands } from './booleanOps';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

const SIZE = 300;
const BACKGROUND: [number, number, number] = [245, 245, 245];
const RED: [number, number, number] = [255, 0, 0];

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

function square(id: string, x: number, y: number): NodeSpec {
	return rectangle({
		id,
		transform: at(x, y),
		width: 60,
		height: 60,
		fills: [solid(0, 1, 0)]
	});
}

/** A boolean at (100, 100) over squares A (0,0) and B (30,30), both 60 x 60. */
function booleanPage(
	operation: BooleanOperationNode['booleanOperation'],
	operands: NodeSpec[] = [square('a', 0, 0), square('b', 30, 30)]
): StoreSceneSource {
	const document = buildDocument([
		page(
			'P',
			[
				node(
					'BOOLEAN_OPERATION',
					{
						id: 'bool',
						booleanOperation: operation,
						transform: at(100, 100),
						width: 90,
						height: 90,
						fills: [solid(1, 0, 0)]
					},
					operands
				)
			],
			{ id: 'p' }
		)
	]);
	return new StoreSceneSource(document, { pageId: 'p' });
}

function pixel(surface: RenderSurface, x: number, y: number): [number, number, number] {
	const [red, green, blue] = surface.readPixels({ x, y, width: 1, height: 1 });
	return [red, green, blue];
}

function draw(source: StoreSceneSource, tracker = new SkiaTracker()): RenderSurface {
	const surface = RenderSurface.offscreen(canvasKit, tracker, SIZE, SIZE);
	const backend = new CanvasKitBackend(canvasKit, tracker, surface);
	backend.render({
		source,
		view: { x: 0, y: 0, scale: 1 },
		size: { width: SIZE, height: SIZE },
		devicePixelRatio: 1
	});
	return surface;
}

function expectColor(
	surface: RenderSurface,
	x: number,
	y: number,
	expected: [number, number, number]
): void {
	const actual = pixel(surface, x, y);
	const label = `pixel ${x},${y} is ${actual.join(',')}, expected ${expected.join(',')}`;
	for (let channel = 0; channel < 3; channel += 1) {
		expect(Math.abs(actual[channel] - expected[channel]), label).toBeLessThanOrEqual(3);
	}
}

// Probe points (canvas pixels): A only, overlap, B only, outside both.
const A_ONLY: [number, number] = [110, 110];
const OVERLAP: [number, number] = [145, 145];
const B_ONLY: [number, number] = [175, 175];
const OUTSIDE: [number, number] = [180, 110];

function expectRegions(
	surface: RenderSurface,
	expected: { a: boolean; overlap: boolean; b: boolean }
): void {
	const colors = (filled: boolean): [number, number, number] => (filled ? RED : BACKGROUND);
	expectColor(surface, ...A_ONLY, colors(expected.a));
	expectColor(surface, ...OVERLAP, colors(expected.overlap));
	expectColor(surface, ...B_ONLY, colors(expected.b));
	expectColor(surface, ...OUTSIDE, BACKGROUND);
}

describe('the four operations', () => {
	it('UNION covers both operands and fills with the boolean node fill', () => {
		expectRegions(draw(booleanPage('UNION')), { a: true, overlap: true, b: true });
	});

	it('SUBTRACT cuts every later operand out of the bottom-most one', () => {
		expectRegions(draw(booleanPage('SUBTRACT')), { a: true, overlap: false, b: false });
	});

	it('SUBTRACT depends on z-order: the bottom operand is the base', () => {
		const swapped = booleanPage('SUBTRACT', [square('b', 30, 30), square('a', 0, 0)]);
		expectRegions(draw(swapped), { a: false, overlap: false, b: true });
	});

	it('INTERSECT keeps only the overlap', () => {
		expectRegions(draw(booleanPage('INTERSECT')), { a: false, overlap: true, b: false });
	});

	it('EXCLUDE keeps everything except the overlap', () => {
		expectRegions(draw(booleanPage('EXCLUDE')), { a: true, overlap: false, b: true });
	});

	it('leaves no Skia objects alive after the frame', () => {
		const tracker = new SkiaTracker();
		const surface = draw(booleanPage('UNION'), tracker);
		expect(surface).toBeDefined();
		expect(tracker.liveCount).toBe(1);
	});
});

describe('operands', () => {
	it('editing an operand updates the result and undo restores it', () => {
		const source = booleanPage('UNION');
		expectColor(draw(source), 175, 175, RED);
		const changes = planSetProps(source.store, 'b', { transform: at(30, 130) });
		const applied = applyChanges(source.store, changes);
		const moved = draw(source);
		expectColor(moved, 175, 175, BACKGROUND);
		expectColor(moved, 145, 245, RED);
		rollback(source.store, applied);
		expectColor(draw(source), 175, 175, RED);
	});

	it('hidden operands do not take part', () => {
		const hidden = rectangle({
			id: 'b',
			transform: at(30, 30),
			width: 60,
			height: 60,
			visible: false
		});
		expectRegions(draw(booleanPage('UNION', [square('a', 0, 0), hidden])), {
			a: true,
			overlap: true,
			b: false
		});
	});

	it('a group operand acts as the union of its children', () => {
		const grouped = group({ id: 'g', transform: at(0, 0), width: 90, height: 90 }, [
			square('a', 0, 0),
			square('c', 60, 0)
		]);
		const surface = draw(booleanPage('SUBTRACT', [grouped, square('b', 30, 30)]));
		expectColor(surface, 110, 110, RED);
		expectColor(surface, 175, 110, RED);
		expectColor(surface, 145, 145, BACKGROUND);
	});

	it('nested booleans compose', () => {
		const inner = node(
			'BOOLEAN_OPERATION',
			{
				id: 'inner',
				booleanOperation: 'UNION',
				transform: at(0, 0),
				width: 90,
				height: 90
			},
			[square('a', 0, 0), square('b', 30, 30)]
		);
		const cutter = rectangle({
			id: 'cut',
			transform: at(30, 30),
			width: 30,
			height: 30,
			fills: [solid(0, 0, 1)]
		});
		const surface = draw(booleanPage('SUBTRACT', [inner, cutter]));
		expectColor(surface, 110, 110, RED);
		expectColor(surface, 145, 145, BACKGROUND);
		expectColor(surface, 175, 175, RED);
	});

	it('transformed operands are placed through their transforms', () => {
		const rotated = rectangle({
			id: 'rot',
			transform: [
				[0, -1, 50],
				[1, 0, 0]
			],
			width: 40,
			height: 20,
			fills: [solid(0, 1, 0)]
		});
		const surface = draw(booleanPage('UNION', [rotated]));
		// the 40 x 20 rect rotated by 90 degrees covers x 30..50, y 0..40 of the boolean
		expectColor(surface, 140, 120, RED);
		expectColor(surface, 120, 120, BACKGROUND);
	});
});

describe('result path', () => {
	it('is exposed as plain commands for flattening', () => {
		const source = booleanPage('INTERSECT');
		const tracker = new SkiaTracker();
		const owned: { delete(): void }[] = [];
		const boolNode = source.getNode('bool');
		if (!boolNode || boolNode.type !== 'BOOLEAN_OPERATION') throw new Error('no boolean');
		const path = booleanResultPath(canvasKit, source, boolNode, (object) => {
			owned.push(object);
			return object;
		});
		expect(path).not.toBeNull();
		if (!path) return;
		const commands = pathToCommands(canvasKit, path);
		const points = commands.flatMap((command) => {
			if (command.op === 'close') return [];
			return [{ x: command.x, y: command.y }];
		});
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		expect(Math.min(...xs)).toBeCloseTo(30);
		expect(Math.max(...xs)).toBeCloseTo(60);
		expect(Math.min(...ys)).toBeCloseTo(30);
		expect(Math.max(...ys)).toBeCloseTo(60);
		expect(commands.at(-1)?.op).toBe('close');
		owned.forEach((object) => object.delete());
		expect(tracker.liveCount).toBe(0);
	});
});
