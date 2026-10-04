// The hand-built document the dev/QA `scene-fixture` plugin loads into the document service, so
// the rendering pipeline can be shown and proven on real document content. Node ids are fixed and
// readable (`frame-a`, `rect-rotated`) so QA scripts and tests can address them.
//
// Extend it as the renderer learns features: one frame per feature family, laid out on the page
// so a screenshot of the fit-all view shows everything.

import type {
	DesignDocument,
	Matrix2x3,
	Paint,
	Stroke,
	StrokeWeights,
	VectorNetwork
} from '../../lib/document';
import {
	buildDocument,
	frame,
	group,
	node,
	page,
	rectangle,
	type NodeSpec
} from '../../lib/document/fixtures';

export const FIXTURE_FILE_ID = 'scene-fixture';
export const FIRST_PAGE_ID = 'page-fixture';
export const SECOND_PAGE_ID = 'page-second';
export const SHAPES_PAGE_ID = 'page-shapes';
export const FIXTURE_COLLECTION_ID = 'collection-theme';
export const FIXTURE_MODE_LIGHT = 'mode-light';
export const FIXTURE_MODE_DARK = 'mode-dark';
export const FIXTURE_BRAND_VARIABLE_ID = 'variable-brand';

export function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

/** Rotation by `degrees` about the node's local origin, then translation to (x, y). */
export function rotationAt(degrees: number, x: number, y: number): Matrix2x3 {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return [
		[cos, -sin, x],
		[sin, cos, y]
	];
}

export function solid(red: number, green: number, blue: number, opacity = 1): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity,
		blendMode: 'NORMAL',
		color: { r: red, g: green, b: blue }
	};
}

export function stroke(
	color: Paint,
	weight: number | StrokeWeights,
	options: Partial<Stroke> = {}
): Stroke {
	return {
		paints: [color],
		weight,
		align: 'CENTER',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: [],
		...options
	};
}

function artboard(
	id: string,
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
	children: NodeSpec[]
): NodeSpec {
	return frame(
		{ id, name, width, height, transform: translation(x, y), fills: [solid(1, 1, 1)] },
		children
	);
}

function swatch(
	id: string,
	x: number,
	y: number,
	size: number,
	color: Paint,
	transform?: Matrix2x3
): NodeSpec {
	return rectangle({
		id,
		name: id,
		width: size,
		height: size,
		transform: transform ?? translation(x, y),
		fills: [color]
	});
}

function firstPage(): NodeSpec {
	return page(
		'Fixture',
		[
			artboard('frame-a', 'Frame A', 0, 0, 400, 300, [
				swatch('rect-red', 40, 40, 120, solid(0.93, 0.26, 0.21)),
				swatch('rect-blue', 200, 40, 120, solid(0.13, 0.46, 0.96)),
				swatch('rect-rotated', 0, 0, 100, solid(0.1, 0.72, 0.42), rotationAt(30, 120, 170)),
				swatch('rect-translucent', 250, 120, 120, solid(0.98, 0.7, 0.1, 0.5))
			]),
			artboard('frame-b', 'Frame B', 600, 100, 300, 300, [
				swatch('rect-purple', 30, 30, 240, solid(0.55, 0.3, 0.9)),
				swatch('rect-pink', 80, 80, 140, solid(0.98, 0.4, 0.65))
			]),
			artboard('frame-c', 'Frame C', 200, 500, 500, 250, [
				frame(
					{
						id: 'frame-nested',
						name: 'Nested frame',
						width: 200,
						height: 150,
						transform: translation(40, 50),
						fills: [solid(0.9, 0.93, 1)]
					},
					[swatch('rect-nested', 20, 20, 90, solid(0.2, 0.2, 0.25))]
				),
				swatch('rect-orange', 300, 60, 140, solid(0.98, 0.5, 0.1))
			])
		],
		{ id: FIRST_PAGE_ID }
	);
}

function secondPage(): NodeSpec {
	return page(
		'Second page',
		[
			artboard('frame-d', 'Frame D', 100, 100, 600, 200, [
				swatch('rect-teal', 40, 40, 120, solid(0.1, 0.7, 0.7)),
				node('ELLIPSE', {
					id: 'ellipse-yellow',
					name: 'Ellipse',
					width: 160,
					height: 120,
					transform: translation(300, 40),
					fills: [solid(0.98, 0.84, 0.2)]
				})
			])
		],
		{ id: SECOND_PAGE_ID }
	);
}

// ---------- the shapes page: node types, strokes, fills and opacity ----------

const INK = solid(0.12, 0.12, 0.16);
const RED = solid(0.93, 0.26, 0.21);
const BLUE = solid(0.13, 0.46, 0.96);
const YELLOW = solid(0.98, 0.84, 0.2);
const PALE = solid(0.9, 0.93, 1);

const BLOB_NETWORK: VectorNetwork = {
	vertices: [
		{ x: 0, y: 60 },
		{ x: 60, y: 0 },
		{ x: 120, y: 60 },
		{ x: 60, y: 120 }
	],
	segments: [
		{ start: 0, end: 1, tangentStart: { x: 0, y: -35 }, tangentEnd: { x: -35, y: 0 } },
		{ start: 1, end: 2, tangentStart: { x: 35, y: 0 }, tangentEnd: { x: 0, y: -35 } },
		{ start: 2, end: 3, tangentStart: { x: 0, y: 35 }, tangentEnd: { x: 35, y: 0 } },
		{ start: 3, end: 0, tangentStart: { x: -35, y: 0 }, tangentEnd: { x: 0, y: 35 } }
	],
	regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
};

const ZIGZAG_NETWORK: VectorNetwork = {
	vertices: [
		{ x: 0, y: 80 },
		{ x: 40, y: 0 },
		{ x: 80, y: 80 },
		{ x: 120, y: 0 }
	],
	segments: [
		{ start: 0, end: 1 },
		{ start: 1, end: 2 },
		{ start: 2, end: 3 }
	]
};

type SwatchType = 'RECTANGLE' | 'ELLIPSE' | 'POLYGON' | 'STAR';

function shape(type: SwatchType, id: string, x: number, y: number, props = {}): NodeSpec {
	return node(type, {
		id,
		name: id,
		width: 100,
		height: 100,
		transform: translation(x, y),
		fills: [BLUE],
		...props
	});
}

function line(id: string, x: number, y: number, length: number, lineStroke: Stroke): NodeSpec {
	return node('LINE', {
		id,
		name: id,
		width: length,
		height: 0,
		transform: translation(x, y),
		strokes: [lineStroke]
	});
}

function shapesFrame(): NodeSpec {
	return artboard('frame-shapes', 'Shapes', 0, 0, 640, 420, [
		shape('RECTANGLE', 'shape-rect', 30, 30),
		shape('RECTANGLE', 'shape-rect-radii', 150, 30, {
			cornerRadius: [40, 0, 40, 0],
			fills: [RED]
		}),
		shape('RECTANGLE', 'shape-rect-round', 270, 30, {
			cornerRadius: 30,
			fills: [solid(0.1, 0.72, 0.42)]
		}),
		shape('RECTANGLE', 'shape-rect-smooth', 390, 30, {
			cornerRadius: 30,
			cornerSmoothing: 0.6,
			fills: [solid(0.1, 0.72, 0.42)]
		}),
		shape('ELLIPSE', 'shape-ellipse', 510, 30, { fills: [solid(0.98, 0.7, 0.1)] }),
		shape('ELLIPSE', 'shape-pie', 30, 160, {
			arcData: { startingAngle: 0.4, endingAngle: 4.6, innerRadius: 0 },
			fills: [solid(0.55, 0.3, 0.9)]
		}),
		shape('ELLIPSE', 'shape-ring', 150, 160, {
			arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.55 },
			fills: [solid(0.98, 0.4, 0.65)]
		}),
		shape('ELLIPSE', 'shape-arc', 270, 160, {
			arcData: { startingAngle: -0.5, endingAngle: 2.8, innerRadius: 0.55 },
			fills: [solid(0.1, 0.7, 0.7)]
		}),
		shape('POLYGON', 'shape-polygon', 390, 160, {
			pointCount: 6,
			fills: [solid(0.98, 0.5, 0.1)]
		}),
		shape('STAR', 'shape-star', 510, 160, { pointCount: 5, innerRadius: 0.45, fills: [YELLOW] }),
		shape('STAR', 'shape-star-round', 30, 290, {
			pointCount: 6,
			innerRadius: 0.55,
			cornerRadius: 8,
			fills: [RED]
		}),
		shape('POLYGON', 'shape-polygon-round', 150, 290, { pointCount: 3, cornerRadius: 14 }),
		node('VECTOR', {
			id: 'shape-vector',
			name: 'shape-vector',
			width: 120,
			height: 120,
			transform: translation(270, 280),
			network: BLOB_NETWORK,
			fills: [solid(0.55, 0.3, 0.9)]
		}),
		node('VECTOR', {
			id: 'shape-vector-open',
			name: 'shape-vector-open',
			width: 120,
			height: 80,
			transform: translation(410, 295),
			network: ZIGZAG_NETWORK,
			strokes: [stroke(INK, 8, { join: 'ROUND', cap: 'ROUND' })]
		}),
		node('LINE', {
			id: 'shape-line',
			name: 'shape-line',
			width: 80,
			height: 0,
			transform: rotationAt(30, 550, 290),
			strokes: [stroke(INK, 6, { cap: 'ROUND' })]
		})
	]);
}

function strokesFrame(): NodeSpec {
	const box = (id: string, x: number, y: number, strokes: Stroke[], props = {}): NodeSpec =>
		shape('RECTANGLE', id, x, y, { fills: [PALE], strokes, ...props });
	return artboard('frame-strokes', 'Strokes', 0, 480, 640, 420, [
		box('stroke-inside', 30, 30, [stroke(RED, 16, { align: 'INSIDE' })]),
		box('stroke-center', 150, 30, [stroke(RED, 16)]),
		box('stroke-outside', 270, 30, [stroke(RED, 16, { align: 'OUTSIDE' })]),
		box('stroke-rounded-inside', 390, 30, [stroke(RED, 16, { align: 'INSIDE' })], {
			cornerRadius: 30
		}),
		shape('ELLIPSE', 'stroke-ellipse', 510, 30, {
			fills: [PALE],
			strokes: [stroke(RED, 12, { align: 'OUTSIDE' })]
		}),
		box('stroke-dashed', 30, 160, [stroke(RED, 6, { dashPattern: [14, 8] })]),
		box('stroke-dotted', 150, 160, [stroke(RED, 8, { dashPattern: [0.1, 14], cap: 'ROUND' })], {
			cornerRadius: 20
		}),
		box(
			'stroke-per-side',
			270,
			160,
			[stroke(RED, { top: 4, right: 20, bottom: 12, left: 0 }, { align: 'INSIDE' })],
			{ cornerRadius: 24 }
		),
		box('stroke-two-paints', 390, 160, [stroke(BLUE, 20), stroke(solid(0.98, 0.84, 0.2, 0.8), 6)]),
		shape('POLYGON', 'stroke-miter', 510, 160, {
			pointCount: 3,
			fills: [PALE],
			strokes: [stroke(RED, 12, { join: 'MITER', miterLimit: 8 })]
		}),
		shape('STAR', 'stroke-round-join', 30, 290, {
			pointCount: 5,
			innerRadius: 0.45,
			fills: [PALE],
			strokes: [stroke(RED, 10, { join: 'ROUND' })]
		}),
		shape('STAR', 'stroke-bevel-join', 150, 290, {
			pointCount: 5,
			innerRadius: 0.45,
			fills: [PALE],
			strokes: [stroke(RED, 10, { join: 'BEVEL' })]
		}),
		line('line-cap-none', 280, 310, 90, stroke(INK, 18, { cap: 'NONE' })),
		line('line-cap-round', 280, 345, 90, stroke(INK, 18, { cap: 'ROUND' })),
		line('line-cap-square', 280, 380, 90, stroke(INK, 18, { cap: 'SQUARE' })),
		line(
			'line-dashed-round',
			400,
			340,
			200,
			stroke(INK, 10, { cap: 'ROUND', dashPattern: [0.1, 18] })
		)
	]);
}

function boundBrandFill(): Paint {
	return {
		...solid(0.5, 0.5, 0.5),
		boundVariables: { color: { type: 'VARIABLE_ALIAS', id: FIXTURE_BRAND_VARIABLE_ID } }
	};
}

function fillsFrame(): NodeSpec {
	return artboard('frame-fills', 'Fills and opacity', 700, 0, 640, 420, [
		rectangle({
			id: 'fills-stacked',
			name: 'fills-stacked',
			width: 140,
			height: 140,
			transform: translation(30, 30),
			fills: [RED, solid(0.13, 0.46, 0.96, 0.6), solid(0.98, 0.84, 0.2, 0.5)]
		}),
		swatch('fills-opacity-back', 210, 30, 120, solid(0.1, 0.72, 0.42)),
		rectangle({
			id: 'fills-opacity-front',
			name: 'fills-opacity-front',
			width: 120,
			height: 120,
			opacity: 0.5,
			transform: translation(260, 70),
			fills: [solid(0.55, 0.3, 0.9)],
			strokes: [stroke(INK, 10, { align: 'INSIDE' })]
		}),
		group(
			{ id: 'fills-group', name: 'fills-group', opacity: 0.45, transform: translation(390, 30) },
			[
				shape('RECTANGLE', 'fills-group-a', 0, 0, { fills: [RED] }),
				shape('ELLIPSE', 'fills-group-b', 50, 40, { fills: [BLUE] })
			]
		),
		rectangle({
			id: 'fills-multiply',
			name: 'fills-multiply',
			width: 120,
			height: 120,
			blendMode: 'MULTIPLY',
			transform: translation(40, 230),
			fills: [YELLOW]
		}),
		rectangle({
			id: 'fills-variable',
			name: 'fills-variable',
			width: 120,
			height: 120,
			transform: translation(200, 230),
			fills: [boundBrandFill()]
		}),
		frame(
			{
				id: 'fills-clip',
				name: 'fills-clip',
				width: 120,
				height: 120,
				cornerRadius: 30,
				transform: translation(360, 230),
				fills: [PALE],
				strokes: [stroke(INK, 4, { align: 'OUTSIDE' })]
			},
			[shape('ELLIPSE', 'fills-clip-child', 50, 50, { fills: [solid(0.98, 0.4, 0.65)] })]
		),
		frame(
			{
				id: 'fills-no-clip',
				name: 'fills-no-clip',
				width: 100,
				height: 100,
				clipsContent: false,
				transform: translation(510, 230),
				fills: [PALE]
			},
			[shape('ELLIPSE', 'fills-no-clip-child', 50, 50, { fills: [solid(0.98, 0.4, 0.65)] })]
		)
	]);
}

function shapesPage(): NodeSpec {
	return page('Shapes', [shapesFrame(), fillsFrame(), strokesFrame()], { id: SHAPES_PAGE_ID });
}

function addThemeVariables(document: DesignDocument): void {
	document.variableCollections[FIXTURE_COLLECTION_ID] = {
		id: FIXTURE_COLLECTION_ID,
		name: 'Theme',
		modes: [
			{ modeId: FIXTURE_MODE_LIGHT, name: 'Light' },
			{ modeId: FIXTURE_MODE_DARK, name: 'Dark' }
		],
		defaultModeId: FIXTURE_MODE_LIGHT,
		variableIds: [FIXTURE_BRAND_VARIABLE_ID]
	};
	document.variables[FIXTURE_BRAND_VARIABLE_ID] = {
		id: FIXTURE_BRAND_VARIABLE_ID,
		name: 'brand',
		collectionId: FIXTURE_COLLECTION_ID,
		resolvedType: 'COLOR',
		valuesByMode: {
			[FIXTURE_MODE_LIGHT]: { r: 0.13, g: 0.46, b: 0.96, a: 1 },
			[FIXTURE_MODE_DARK]: { r: 0.98, g: 0.4, b: 0.2, a: 1 }
		},
		scopes: [],
		codeSyntax: {},
		description: ''
	};
}

export function buildFixtureDocument(): DesignDocument {
	const document = buildDocument([firstPage(), secondPage(), shapesPage()]);
	addThemeVariables(document);
	document.id = FIXTURE_FILE_ID;
	document.name = 'Scene fixture';
	return document;
}
