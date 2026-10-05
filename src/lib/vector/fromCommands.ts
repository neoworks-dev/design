// Path commands to a vector network: what flattening a boolean result stores (data-model
// section 7: vector networks are canonical, SVG-like paths are import/export). Closed contours
// become the loops of one region, open contours stay strokes only.

import type { FillRule, PathCommand } from '../document/outline';
import type { VectorNetwork } from '../document/types';
import { appendVertex, connectVertices, emptyNetwork } from './network';
import type { Point } from './geometry';

const SAME_POINT = 1e-4;

function samePoint(first: Point, second: Point): boolean {
	return Math.abs(first.x - second.x) < SAME_POINT && Math.abs(first.y - second.y) < SAME_POINT;
}

interface Contour {
	startVertex: number;
	startPoint: Point;
	currentVertex: number;
	currentPoint: Point;
	segments: number[];
}

/** `arc` commands are not produced by PathOps; they are approximated by their chord. */
export function commandsToNetwork(
	commands: readonly PathCommand[],
	windingRule: FillRule
): VectorNetwork {
	const network = emptyNetwork();
	const loops: number[][] = [];
	let contour: Contour | null = null;

	const endVertex = (point: Point, index: number): number => {
		const next = commands[index + 1];
		const closesHere = next !== undefined && next.op === 'close';
		if (contour && closesHere && samePoint(point, contour.startPoint)) return contour.startVertex;
		return appendVertex(network, point);
	};

	const extend = (index: number, point: Point, tangents?: [Point, Point]): void => {
		if (!contour) return;
		const vertex = endVertex(point, index);
		const segment = connectVertices(
			network,
			contour.currentVertex,
			vertex,
			tangents ? tangents[0] : undefined,
			tangents ? tangents[1] : undefined
		);
		contour.segments.push(segment);
		contour.currentVertex = vertex;
		contour.currentPoint = point;
	};

	commands.forEach((command, index) => {
		if (command.op === 'move') {
			const vertex = appendVertex(network, command);
			const point = { x: command.x, y: command.y };
			contour = {
				startVertex: vertex,
				startPoint: point,
				currentVertex: vertex,
				currentPoint: point,
				segments: []
			};
			return;
		}
		if (!contour) return;
		if (command.op === 'line' || command.op === 'arc') {
			extend(index, { x: command.x, y: command.y });
			return;
		}
		if (command.op === 'cubic') {
			const end = { x: command.x, y: command.y };
			const start = contour.currentPoint;
			extend(index, end, [
				{ x: command.x1 - start.x, y: command.y1 - start.y },
				{ x: command.x2 - end.x, y: command.y2 - end.y }
			]);
			return;
		}
		if (contour.currentVertex !== contour.startVertex) {
			const segment = connectVertices(network, contour.currentVertex, contour.startVertex);
			contour.segments.push(segment);
		}
		if (contour.segments.length > 0) loops.push(contour.segments);
		contour = null;
	});

	if (loops.length > 0) network.regions = [{ windingRule, loops }];
	return network;
}
