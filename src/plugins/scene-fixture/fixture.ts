// The hand-built document the dev/QA `scene-fixture` plugin serves to the renderer, so the
// rendering pipeline can be shown and proven before the real document service exists. Node ids are
// fixed and readable (`frame-a`, `rect-rotated`) so QA scripts and tests can address them.
//
// Extend it as the renderer learns features: one frame per feature family, laid out on the page
// so a screenshot of the fit-all view shows everything.

import type { DesignDocument, Matrix2x3, Paint } from '../../lib/document';
import {
	buildDocument,
	frame,
	node,
	page,
	rectangle,
	type NodeSpec
} from '../../lib/document/fixtures';

export const FIXTURE_FILE_ID = 'scene-fixture';
export const FIRST_PAGE_ID = 'page-fixture';
export const SECOND_PAGE_ID = 'page-second';

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

export function buildFixtureDocument(): DesignDocument {
	const document = buildDocument([firstPage(), secondPage()]);
	document.id = FIXTURE_FILE_ID;
	document.name = 'Scene fixture';
	return document;
}
