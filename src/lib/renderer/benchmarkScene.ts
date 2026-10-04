// A generated scene for render benchmarks (#45): a grid of frames, each a grid of small rectangles
// with a few strokes and some opacity, so the draw cost resembles a real screen design. Pure data
// (a DesignDocument), usable by tests and by the app's QA tooling.

import { buildDocument, frame, page, rectangle, type NodeSpec } from '../document/fixtures';
import type { DesignDocument, Matrix2x3, Paint } from '../document/types';

export const BENCHMARK_PAGE_ID = 'benchmark-page';
export const FRAME_SIZE = 400;
export const FRAME_GAP = 100;
export const CELLS_PER_SIDE = 20;
export const NODES_PER_FRAME = CELLS_PER_SIDE * CELLS_PER_SIDE;

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function solidFill(red: number, green: number, blue: number): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: red, g: green, b: blue }
	};
}

function cell(frameNumber: number, row: number, column: number): NodeSpec {
	const seed = frameNumber * 7 + row * 3 + column;
	const size = FRAME_SIZE / CELLS_PER_SIDE;
	const props: Parameters<typeof rectangle>[0] = {
		id: `bench-${frameNumber}-${row}-${column}`,
		width: size - 4,
		height: size - 4,
		transform: translation(column * size + 2, row * size + 2),
		fills: [solidFill((seed % 10) / 10, ((seed * 3) % 10) / 10, ((seed * 7) % 10) / 10)]
	};
	if (seed % 11 === 0) props.opacity = 0.6;
	return rectangle(props);
}

function benchmarkFrame(frameNumber: number, columns: number): NodeSpec {
	const cells: NodeSpec[] = [];
	for (let row = 0; row < CELLS_PER_SIDE; row += 1) {
		for (let column = 0; column < CELLS_PER_SIDE; column += 1) {
			cells.push(cell(frameNumber, row, column));
		}
	}
	const gridRow = Math.floor(frameNumber / columns);
	const gridColumn = frameNumber % columns;
	return frame(
		{
			id: `bench-frame-${frameNumber}`,
			width: FRAME_SIZE,
			height: FRAME_SIZE,
			clipsContent: true,
			transform: translation(
				gridColumn * (FRAME_SIZE + FRAME_GAP),
				gridRow * (FRAME_SIZE + FRAME_GAP)
			),
			fills: [solidFill(1, 1, 1)]
		},
		cells
	);
}

/** `frameCount` frames of 400 rectangles each in a square-ish grid: 25 frames is 10,025 nodes. */
export function benchmarkDocument(frameCount: number): DesignDocument {
	const columns = Math.ceil(Math.sqrt(frameCount));
	const frames: NodeSpec[] = [];
	for (let number = 0; number < frameCount; number += 1)
		frames.push(benchmarkFrame(number, columns));
	return buildDocument([page('Benchmark', frames, { id: BENCHMARK_PAGE_ID })]);
}
