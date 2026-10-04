import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { nodeOutline, roundedRectangleCommands, vectorNetworkOutline } from './outline';
import type { VectorNetwork } from './types';

function operations(commands: { op: string }[]): string[] {
	return commands.map((command) => command.op);
}

describe('roundedRectangleCommands', () => {
	it('is four lines and a close without radius', () => {
		const commands = roundedRectangleCommands(0, 0, 40, 20, 0);
		expect(operations(commands)).toEqual(['move', 'line', 'line', 'line', 'close']);
	});

	it('uses one quarter arc per rounded corner and only for those corners', () => {
		const commands = roundedRectangleCommands(0, 0, 40, 20, [5, 0, 5, 0]);
		expect(commands.filter((command) => command.op === 'arc')).toHaveLength(2);
	});

	it('clamps radii so a corner never reaches past half the shorter side', () => {
		const commands = roundedRectangleCommands(0, 0, 40, 20, 100);
		const arc = commands.find((command) => command.op === 'arc');
		expect(arc).toMatchObject({ radiusX: 10, radiusY: 10 });
	});

	it('smoothing adds easing curves on both sides of each arc', () => {
		const commands = roundedRectangleCommands(0, 0, 100, 100, 20, 0.6);
		expect(commands.filter((command) => command.op === 'cubic')).toHaveLength(8);
	});

	it('smoothing keeps the curve inside the box', () => {
		const commands = roundedRectangleCommands(0, 0, 100, 100, 30, 1);
		for (const command of commands) {
			if (command.op === 'close') continue;
			expect(command.x).toBeGreaterThanOrEqual(-1e-9);
			expect(command.x).toBeLessThanOrEqual(100 + 1e-9);
			expect(command.y).toBeGreaterThanOrEqual(-1e-9);
			expect(command.y).toBeLessThanOrEqual(100 + 1e-9);
		}
	});

	it('translates to the requested origin', () => {
		const [first] = roundedRectangleCommands(10, 20, 40, 20, 0);
		expect(first).toEqual({ op: 'move', x: 50, y: 20 });
	});
});

describe('nodeOutline', () => {
	it('returns an outline for every shape type and none for pages, groups, text and slices', () => {
		for (const type of [
			'FRAME',
			'RECTANGLE',
			'ELLIPSE',
			'POLYGON',
			'STAR',
			'LINE',
			'VECTOR',
			'SECTION'
		]) {
			expect(nodeOutline(createNode(type as 'FRAME', { id: 'x' })), type).not.toBeNull();
		}
		for (const type of ['GROUP', 'TEXT', 'SLICE']) {
			expect(nodeOutline(createNode(type as 'GROUP', { id: 'x' })), type).toBeNull();
		}
	});

	it('a full ellipse is one closed contour of quarter arcs; a ring adds an opposite hole', () => {
		const full = nodeOutline(createNode('ELLIPSE', { id: 'e', width: 20, height: 10 }));
		expect(operations(full?.fill ?? [])).toEqual(['move', 'arc', 'arc', 'arc', 'arc', 'close']);
		const ring = nodeOutline(
			createNode('ELLIPSE', {
				id: 'r',
				arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.5 }
			})
		);
		const arcs = (ring?.fill ?? []).filter((command) => command.op === 'arc');
		expect(arcs.filter((arc) => arc.op === 'arc' && arc.clockwise)).toHaveLength(4);
		expect(arcs.filter((arc) => arc.op === 'arc' && !arc.clockwise)).toHaveLength(4);
	});

	it('a pie slice closes through the center', () => {
		const pie = nodeOutline(
			createNode('ELLIPSE', {
				id: 'p',
				width: 20,
				height: 20,
				arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 }
			})
		);
		expect(pie?.fill).toContainEqual({ op: 'line', x: 10, y: 10 });
	});

	it('a polygon has one corner per point; a star twice as many', () => {
		const polygon = nodeOutline(createNode('POLYGON', { id: 'p', pointCount: 5 }));
		const star = nodeOutline(createNode('STAR', { id: 's', pointCount: 5 }));
		expect(polygon?.fill.filter((command) => command.op !== 'close')).toHaveLength(5);
		expect(star?.fill.filter((command) => command.op !== 'close')).toHaveLength(10);
	});

	it('a line is an open stroke-only path', () => {
		const outline = nodeOutline(createNode('LINE', { id: 'l', width: 30 }));
		expect(outline).toMatchObject({ fill: [], closed: false });
		expect(outline?.stroke).toEqual([
			{ op: 'move', x: 0, y: 0 },
			{ op: 'line', x: 30, y: 0 }
		]);
	});
});

describe('vectorNetworkOutline', () => {
	const triangle: VectorNetwork = {
		vertices: [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 5, y: 8 }
		],
		segments: [
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 2, end: 0 }
		],
		regions: [{ windingRule: 'EVENODD', loops: [[0, 1, 2]] }]
	};

	it('chains segments into one stroke subpath and builds a closed fill from regions', () => {
		const outline = vectorNetworkOutline(triangle);
		expect(operations(outline.stroke)).toEqual(['move', 'line', 'line', 'line']);
		expect(operations(outline.fill)).toEqual(['move', 'line', 'line', 'line', 'close']);
		expect(outline).toMatchObject({ closed: true, fillRule: 'EVENODD' });
	});

	it('walks a loop whose segments are stored against the loop direction', () => {
		const flipped: VectorNetwork = {
			...triangle,
			segments: [
				{ start: 1, end: 0 },
				{ start: 1, end: 2 },
				{ start: 2, end: 0 }
			]
		};
		const outline = vectorNetworkOutline(flipped);
		expect(outline.fill[0]).toEqual({ op: 'move', x: 0, y: 0 });
		expect(outline.fill[1]).toEqual({ op: 'line', x: 10, y: 0 });
		expect(outline.fill[2]).toEqual({ op: 'line', x: 5, y: 8 });
	});

	it('turns tangents into cubic segments and leaves networks without regions unfilled', () => {
		const open: VectorNetwork = {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 }
			],
			segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 5 }, tangentEnd: { x: 0, y: 5 } }]
		};
		const outline = vectorNetworkOutline(open);
		expect(outline.stroke[1]).toEqual({ op: 'cubic', x1: 0, y1: 5, x2: 10, y2: 5, x: 10, y: 0 });
		expect(outline).toMatchObject({ fill: [], closed: false });
	});

	it('skips segments that point at missing vertices', () => {
		const broken: VectorNetwork = {
			vertices: [{ x: 0, y: 0 }],
			segments: [{ start: 0, end: 4 }]
		};
		expect(vectorNetworkOutline(broken).stroke).toEqual([]);
	});
});
