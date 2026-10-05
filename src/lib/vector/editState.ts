// State of the vector edit mode (issues #61, #62): which vector is open, what is selected, the
// gesture in progress and the live preview network shown while a drag runs. Plain data; the
// tool bumps `revision` so the overlay redraws.

import type { NodeId, VectorNetwork } from '../document/types';
import type { Point } from './geometry';
import { Revision } from './revision.svelte';

export type VectorHit =
	| { kind: 'vertex'; index: number }
	| { kind: 'handle'; segment: number; vertex: number }
	| { kind: 'segment'; index: number; t: number }
	| { kind: 'region'; index: number };

export type EditGesture =
	| { kind: 'move'; start: Point; base: VectorNetwork; vertices: ReadonlySet<number> }
	| { kind: 'handle'; segment: number; vertex: number; base: VectorNetwork; start: Point }
	| { kind: 'bend-vertex'; vertex: number; base: VectorNetwork; start: Point }
	| { kind: 'bend-segment'; segment: number; t: number; base: VectorNetwork; start: Point }
	| { kind: 'marquee'; additive: boolean };

export interface MarqueeBox {
	from: Point;
	to: Point;
}

export class VectorEditState {
	nodeId: NodeId | null = null;
	selectedVertices = new Set<number>();
	selectedSegments = new Set<number>();
	hover: VectorHit | null = null;
	/** The network drawn while a gesture runs; null when the stored one is shown. */
	preview: VectorNetwork | null = null;
	gesture: EditGesture | null = null;
	/** Screen-space marquee rectangle. */
	marquee: MarqueeBox | null = null;
	/** Paint bucket mode (B): clicking a region fills it. */
	bucket = false;
	readonly revision = new Revision();

	get active(): boolean {
		return this.nodeId !== null;
	}

	open(nodeId: NodeId): void {
		this.reset();
		this.nodeId = nodeId;
		this.revision.bump();
	}

	reset(): void {
		this.nodeId = null;
		this.clearSelection();
		this.hover = null;
		this.preview = null;
		this.gesture = null;
		this.marquee = null;
		this.bucket = false;
		this.revision.bump();
	}

	clearSelection(): void {
		this.selectedVertices = new Set();
		this.selectedSegments = new Set();
	}

	selectVertices(vertices: Iterable<number>, additive: boolean): void {
		const next = additive ? new Set(this.selectedVertices) : new Set<number>();
		for (const vertex of vertices) next.add(vertex);
		this.selectedVertices = next;
		if (!additive) this.selectedSegments = new Set();
	}

	toggleVertex(vertex: number): void {
		const next = new Set(this.selectedVertices);
		if (next.has(vertex)) next.delete(vertex);
		else next.add(vertex);
		this.selectedVertices = next;
	}

	selectSegment(segment: number, additive: boolean): void {
		const next = additive ? new Set(this.selectedSegments) : new Set<number>();
		if (additive && next.has(segment)) next.delete(segment);
		else next.add(segment);
		this.selectedSegments = next;
		if (!additive) this.selectedVertices = new Set();
	}
}
