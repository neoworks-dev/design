// The pen's state machine (issue #60), pure and in the draft's local coordinates. Click makes a
// corner point, click-drag a smooth point with symmetric handles. Clicking the first point of the
// chain closes it; clicking another vertex connects to it; clicking a vertex of an existing
// network branches from it. The tool wraps this and commits the result as ONE change set.

import type { VectorNetwork } from '../document/types';
import { copyNetwork, type Point } from './geometry';
import {
	addRegionClosedBy,
	appendVertex,
	connectVertices,
	emptyNetwork,
	segmentsAt
} from './network';

export type PressResult = 'added' | 'closed' | 'connected' | 'continued' | 'ignored';

interface Snapshot {
	network: VectorNetwork;
	active: number | null;
	chainStart: number | null;
	outHandles: [number, Point][];
}

const DEFAULT_ANGLE_STEP = Math.PI / 4;
const MINIMUM_HANDLE = 0.5;

/** `point` moved onto the nearest multiple of 45 degrees around `origin`. */
export function constrainAngle(origin: Point, point: Point): Point {
	const offsetX = point.x - origin.x;
	const offsetY = point.y - origin.y;
	const length = Math.hypot(offsetX, offsetY);
	if (length === 0) return point;
	const angle = Math.round(Math.atan2(offsetY, offsetX) / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP;
	return { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
}

export class PenSession {
	network: VectorNetwork;
	/** The vertex the next point connects from. */
	active: number | null = null;
	/** First vertex of the current chain: clicking it closes the path. */
	chainStart: number | null = null;
	cursor: Point | null = null;
	/** Outgoing handle (relative) of vertices dragged out while building. */
	readonly outHandles = new Map<number, Point>();
	private dragging: { vertex: number; incoming: number | null } | null = null;
	private readonly undoStack: Snapshot[] = [];
	private touched = false;

	constructor(network: VectorNetwork = emptyNetwork()) {
		this.network = copyNetwork(network);
	}

	get isDragging(): boolean {
		return this.dragging !== null;
	}

	vertexAt(point: Point, radius: number): number {
		for (let index = this.network.vertices.length - 1; index >= 0; index -= 1) {
			const vertex = this.network.vertices[index];
			if (Math.hypot(vertex.x - point.x, vertex.y - point.y) <= radius) return index;
		}
		return -1;
	}

	/** True while hovering the first point of a chain that can be closed. */
	canCloseAt(point: Point, radius: number): boolean {
		if (this.active === null || this.chainStart === null) return false;
		if (this.chainStart === this.active) return false;
		return this.vertexAt(point, radius) === this.chainStart;
	}

	press(point: Point, radius: number, constrain: boolean): PressResult {
		const hit = this.vertexAt(point, radius);
		if (hit >= 0) return this.pressVertex(hit);
		this.remember();
		let position = point;
		if (constrain && this.active !== null) {
			position = constrainAngle(this.network.vertices[this.active], point);
		}
		const vertex = appendVertex(this.network, position);
		let incoming: number | null = null;
		if (this.active !== null) incoming = this.connectFromActive(vertex);
		else this.chainStart = vertex;
		this.active = vertex;
		this.dragging = { vertex, incoming };
		return 'added';
	}

	private pressVertex(vertex: number): PressResult {
		if (this.active === null) {
			this.active = vertex;
			this.chainStart = vertex;
			return 'continued';
		}
		if (vertex === this.active) return 'ignored';
		this.remember();
		const closing = vertex === this.chainStart;
		const segment = this.connectFromActive(vertex);
		const closingHandle = this.outHandles.get(vertex);
		if (closing && closingHandle) {
			this.network.segments[segment].tangentEnd = {
				x: 0 - closingHandle.x,
				y: 0 - closingHandle.y
			};
		}
		addRegionClosedBy(this.network, segment);
		this.active = null;
		this.chainStart = null;
		if (closing) return 'closed';
		return 'connected';
	}

	private connectFromActive(target: number): number {
		const from = this.active as number;
		return connectVertices(this.network, from, target, this.outHandles.get(from));
	}

	/** Dragging after a press pulls out symmetric handles at the new point. */
	drag(point: Point): void {
		if (!this.dragging) return;
		const vertex = this.network.vertices[this.dragging.vertex];
		const handle = { x: point.x - vertex.x, y: point.y - vertex.y };
		if (Math.hypot(handle.x, handle.y) < MINIMUM_HANDLE) return;
		this.outHandles.set(this.dragging.vertex, handle);
		vertex.handleMirroring = 'ANGLE_AND_LENGTH';
		const incoming = this.dragging.incoming;
		if (incoming === null) return;
		this.network.segments[incoming].tangentEnd = { x: 0 - handle.x, y: 0 - handle.y };
	}

	release(): void {
		this.dragging = null;
	}

	hover(point: Point, constrain: boolean): void {
		if (constrain && this.active !== null) {
			this.cursor = constrainAngle(this.network.vertices[this.active], point);
			return;
		}
		this.cursor = point;
	}

	/** Removes the last point placed (undo while building). Returns false when there is none. */
	undoLastPoint(): boolean {
		const snapshot = this.undoStack.pop();
		if (!snapshot) return false;
		this.network = snapshot.network;
		this.active = snapshot.active;
		this.chainStart = snapshot.chainStart;
		this.outHandles.clear();
		snapshot.outHandles.forEach(([vertex, handle]) => this.outHandles.set(vertex, handle));
		this.dragging = null;
		return true;
	}

	/** Ends the current chain; the next press starts a new one. */
	endChain(): void {
		this.active = null;
		this.chainStart = null;
		this.dragging = null;
	}

	/** The network to commit, or null when nothing worth keeping was drawn. */
	finish(): VectorNetwork | null {
		if (!this.touched) return null;
		if (this.network.segments.length === 0) return null;
		return copyNetwork(this.network);
	}

	hasIncidentSegments(vertex: number): boolean {
		return segmentsAt(this.network, vertex).length > 0;
	}

	private remember(): void {
		this.touched = true;
		this.undoStack.push({
			network: copyNetwork(this.network),
			active: this.active,
			chainStart: this.chainStart,
			outHandles: [...this.outHandles.entries()]
		});
	}
}
