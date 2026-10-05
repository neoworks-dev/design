// The vector edit mode (issue #61): select vertices and segments by click, Shift-click and
// marquee, drag to move, arrows to nudge, Delete / Shift+Delete to delete or heal, Ctrl+J to join,
// Esc or Enter to leave. Every gesture is ONE change set, applied on release, with a preview
// network drawn by the overlay while it runs.

import type { Context } from '@neoworks/extension-system';
import type { VectorNode } from '../document/types';
import { transformPoint } from '../document/matrix';
import { applyEdit } from '../editing/contribute';
import type { OverlayContribution } from '../overlay/types';
import type { ToolContribution } from '../registries/tools.svelte';
import { PointerGesture, type ToolKeyEvent, type ToolPointerEvent } from '../tools/protocol';
import {
	existingDraftSpace,
	updateVectorNode,
	worldToDraft,
	type DraftSpace
} from './createVector';
import {
	deleteSelection,
	endpointsOfSegments,
	flattenNetwork,
	hitNetwork,
	joinSelection
} from './editOps';
import type { VectorEditState, VectorHit } from './editState';
import type { Point } from './geometry';
import {
	dragAdvanced,
	pressAdvanced,
	regionHover,
	releaseAdvanced,
	toggleBucket
} from './editAdvanced';
import { drawNetworkOverlay } from './overlayDraw';
import { moveVertices, segmentsAt, otherEnd } from './network';
import type { VectorNetwork } from '../document/types';

export const VECTOR_EDIT_TOOL_ID = 'vector-edit';
const HIT_RADIUS_PIXELS = 6;
const PRIMARY_BUTTON = 0;
const NUDGE = 1;
const BIG_NUDGE = 10;

const ARROWS: Record<string, Point> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 }
};

type EditHandlers = Pick<
	ToolContribution,
	| 'onPointerDown'
	| 'onPointerMove'
	| 'onPointerUp'
	| 'onPointerLeave'
	| 'onKey'
	| 'onCancel'
	| 'onDeactivate'
>;

/** Everything the edit mode does, over one context and one state. */
export class VectorEditor {
	private readonly gesture = new PointerGesture();
	private pressScreen: Point = { x: 0, y: 0 };

	constructor(
		readonly ctx: Context,
		readonly state: VectorEditState
	) {}

	// ---------- access ----------

	node(): VectorNode | null {
		const id = this.state.nodeId;
		if (id === null) return null;
		const node = this.ctx.document.get(id);
		if (!node || node.type !== 'VECTOR') return null;
		return node;
	}

	space(): DraftSpace | null {
		const id = this.state.nodeId;
		if (id === null || !this.node()) return null;
		return existingDraftSpace(this.ctx, id);
	}

	/** The network on screen: the live preview during a gesture, else the stored one. */
	network(): VectorNetwork | null {
		const node = this.node();
		if (!node) return null;
		if (this.state.preview) return this.state.preview;
		return node.network;
	}

	radius(space: DraftSpace): number {
		const [[a, c], [b, d]] = space.toWorld;
		const scale = Math.sqrt(Math.abs(a * d - b * c));
		return HIT_RADIUS_PIXELS / this.ctx.viewport.zoom / Math.max(scale, 1e-6);
	}

	/** Vertices whose handles are shown: the selected ones and their direct neighbours. */
	handleVertices(network: VectorNetwork): Set<number> {
		const shown = new Set<number>(this.state.selectedVertices);
		for (const vertex of this.state.selectedVertices) {
			for (const index of segmentsAt(network, vertex)) {
				shown.add(otherEnd(network.segments[index], vertex));
			}
		}
		return shown;
	}

	selection(network: VectorNetwork): { vertices: Set<number>; segments: Set<number> } {
		const vertices = new Set(this.state.selectedVertices);
		for (const vertex of endpointsOfSegments(network, this.state.selectedSegments)) {
			if (this.state.selectedVertices.size === 0) vertices.add(vertex);
		}
		return { vertices, segments: new Set(this.state.selectedSegments) };
	}

	// ---------- lifecycle ----------

	enter(id: string): void {
		this.state.open(id);
		this.ctx.tools.activate(VECTOR_EDIT_TOOL_ID);
	}

	exit(): void {
		this.gesture.cancel();
		this.state.reset();
		if (this.ctx.tools.activeId() === VECTOR_EDIT_TOOL_ID) this.ctx.tools.revertToDefault();
	}

	// ---------- committing ----------

	commit(label: string, network: VectorNetwork): void {
		const id = this.state.nodeId;
		if (id === null) return;
		this.state.preview = null;
		if (network.vertices.length === 0) {
			applyEdit(this.ctx, this.ctx.document.removeNode(id), 'Delete vector');
			this.exit();
			return;
		}
		updateVectorNode(this.ctx, id, network, label);
		this.state.revision.bump();
	}

	deleteSelected(heal: boolean): void {
		const network = this.network();
		if (!network) return;
		const result = deleteSelection(network, this.selection(network), heal);
		if (!result) return;
		this.state.clearSelection();
		this.commit(heal ? 'Delete and heal vertices' : 'Delete vertices', result);
	}

	joinSelected(): void {
		const network = this.network();
		if (!network) return;
		const result = joinSelection(network, this.selection(network));
		if (result) this.commit('Join vertices', result);
	}

	flatten(): void {
		const network = this.network();
		if (!network) return;
		const result = flattenNetwork(network);
		if (result) this.commit('Flatten vector', result);
		this.exit();
	}

	private nudge(direction: Point, big: boolean): void {
		const network = this.network();
		const space = this.space();
		if (!network || !space) return;
		const { vertices } = this.selection(network);
		if (vertices.size === 0) return;
		const amount = big ? BIG_NUDGE : NUDGE;
		const delta = this.localDelta(space, { x: direction.x * amount, y: direction.y * amount });
		this.commit('Nudge vertices', moveVertices(network, vertices, delta));
	}

	/** A world-space vector as local units (linear part of the inverse transform). */
	localDelta(space: DraftSpace, world: Point): Point {
		const origin = worldToDraft(space, { x: 0, y: 0 });
		const target = worldToDraft(space, world);
		return { x: target.x - origin.x, y: target.y - origin.y };
	}

	// ---------- pointer ----------

	private screenOf(space: DraftSpace, point: Point): Point {
		const world = transformPoint(space.toWorld, point.x, point.y);
		return this.ctx.viewport.worldToScreen(world);
	}

	hitAt(world: Point): VectorHit | null {
		const space = this.space();
		const network = this.network();
		if (!space || !network) return null;
		return hitNetwork(
			network,
			worldToDraft(space, world),
			this.radius(space),
			this.handleVertices(network)
		);
	}

	pointerDown(event: ToolPointerEvent): void {
		if (event.button !== PRIMARY_BUTTON) return;
		const network = this.network();
		const space = this.space();
		if (!network || !space) {
			this.exit();
			return;
		}
		this.pressScreen = event.screen;
		this.gesture.press(event.screen);
		const local = worldToDraft(space, event.world);
		const hit = this.hitAt(event.world);
		if (pressAdvanced(this, network, hit, local, event)) {
			this.state.revision.bump();
			return;
		}
		if (hit?.kind === 'vertex') {
			this.pressVertex(network, hit.index, local, event.shiftKey);
		} else if (hit?.kind === 'segment') {
			this.pressSegment(network, hit.index, local, event.shiftKey);
		} else {
			this.state.gesture = { kind: 'marquee', additive: event.shiftKey };
			if (!event.shiftKey) this.state.clearSelection();
		}
		this.state.revision.bump();
	}

	private pressVertex(
		network: VectorNetwork,
		vertex: number,
		start: Point,
		additive: boolean
	): void {
		if (additive) this.state.toggleVertex(vertex);
		else if (!this.state.selectedVertices.has(vertex)) this.state.selectVertices([vertex], false);
		this.state.selectedSegments = additive ? this.state.selectedSegments : new Set();
		this.state.gesture = {
			kind: 'move',
			start,
			base: network,
			vertices: new Set(this.state.selectedVertices)
		};
	}

	private pressSegment(
		network: VectorNetwork,
		segment: number,
		start: Point,
		additive: boolean
	): void {
		if (!this.state.selectedSegments.has(segment) || additive)
			this.state.selectSegment(segment, additive);
		const vertices = endpointsOfSegments(network, this.state.selectedSegments);
		this.state.gesture = { kind: 'move', start, base: network, vertices };
	}

	pointerMove(event: ToolPointerEvent): void {
		const space = this.space();
		if (!space) return;
		const gesture = this.state.gesture;
		if (!gesture) {
			this.state.hover = this.hoverAt(event.world);
			this.state.revision.bump();
			return;
		}
		const update = this.gesture.move(event.screen);
		if (update.phase !== 'dragging') return;
		const local = worldToDraft(space, event.world);
		if (gesture.kind === 'marquee')
			this.state.marquee = { from: this.pressScreen, to: event.screen };
		if (gesture.kind === 'move') {
			const delta = { x: local.x - gesture.start.x, y: local.y - gesture.start.y };
			this.state.preview = moveVertices(gesture.base, gesture.vertices, delta);
		}
		dragAdvanced(this, gesture, local, event.altKey);
		this.state.revision.bump();
	}

	pointerUp(event: ToolPointerEvent): void {
		const gesture = this.state.gesture;
		const result = this.gesture.release();
		this.state.gesture = null;
		this.state.marquee = null;
		if (!gesture) return;
		if (gesture.kind === 'marquee') this.finishMarquee(result, event, gesture.additive);
		const preview = this.state.preview;
		if (gesture.kind === 'move' && result === 'drag' && preview)
			this.commit('Move vertices', preview);
		releaseAdvanced(this, gesture, result);
		this.state.preview = null;
		this.state.revision.bump();
	}

	private hoverAt(world: Point): VectorHit | null {
		const space = this.space();
		if (!space || !this.state.bucket) return this.hitAt(world);
		return regionHover(this, worldToDraft(space, world));
	}

	private finishMarquee(
		result: 'click' | 'drag' | 'none',
		event: ToolPointerEvent,
		additive: boolean
	): void {
		const space = this.space();
		const network = this.network();
		if (!space || !network) return;
		if (result !== 'drag') {
			if (event.detail >= 2) this.exit();
			return;
		}
		const from = this.pressScreen;
		const inside = network.vertices
			.map((vertex, index) => ({ index, screen: this.screenOf(space, vertex) }))
			.filter(({ screen }) => within(screen, from, event.screen))
			.map(({ index }) => index);
		this.state.selectVertices(inside, additive || event.shiftKey);
	}

	cancelGesture(): boolean {
		if (!this.state.gesture) return false;
		this.gesture.cancel();
		this.state.gesture = null;
		this.state.preview = null;
		this.state.marquee = null;
		this.state.revision.bump();
		return true;
	}

	// ---------- keyboard ----------

	key(event: ToolKeyEvent): boolean {
		if (event.key === 'Enter' || event.key === 'Escape') {
			event.preventDefault();
			if (event.key === 'Escape' && this.cancelGesture()) return true;
			this.exit();
			return true;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			this.deleteSelected(event.shiftKey);
			return true;
		}
		if (event.key.toLowerCase() === 'j' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			this.joinSelected();
			return true;
		}
		if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			toggleBucket(this);
			return true;
		}
		const arrow = ARROWS[event.key];
		if (!arrow) return false;
		event.preventDefault();
		this.nudge(arrow, event.shiftKey);
		return true;
	}
}

function within(point: Point, first: Point, second: Point): boolean {
	return (
		point.x >= Math.min(first.x, second.x) &&
		point.x <= Math.max(first.x, second.x) &&
		point.y >= Math.min(first.y, second.y) &&
		point.y <= Math.max(first.y, second.y)
	);
}

export function createEditTool(editor: VectorEditor): EditHandlers {
	return {
		onPointerDown: (event) => editor.pointerDown(event),
		onPointerMove: (event) => editor.pointerMove(event),
		onPointerUp: (event) => editor.pointerUp(event),
		onPointerLeave(): void {
			editor.state.hover = null;
			editor.state.revision.bump();
		},
		onKey: (event) => editor.key(event),
		onCancel(): boolean {
			if (editor.cancelGesture()) return true;
			editor.exit();
			return true;
		},
		onDeactivate: () => editor.state.reset()
	};
}

/** Overlay: the vector's path with points and handles, the selection and the marquee. */
export function editOverlay(editor: VectorEditor): OverlayContribution {
	return {
		id: 'vector-edit/network',
		order: 50,
		track: () => void editor.state.revision.value,
		draw(frame): void {
			const network = editor.network();
			const space = editor.space();
			if (!network || !space) return;
			const { state } = editor;
			drawNetworkOverlay(frame, space.toWorld, network, {
				selectedVertices: state.selectedVertices,
				selectedSegments: state.selectedSegments,
				hoverVertex: state.hover?.kind === 'vertex' ? state.hover.index : undefined,
				hoverSegment: state.hover?.kind === 'segment' ? state.hover.index : undefined,
				handleVertices: editor.handleVertices(network),
				highlightRegion: state.hover?.kind === 'region' ? state.hover.index : undefined
			});
			drawMarquee(frame, state.marquee);
		}
	};
}

function drawMarquee(
	frame: Parameters<OverlayContribution['draw']>[0],
	marquee: { from: Point; to: Point } | null
): void {
	if (!marquee) return;
	const { ctx } = frame;
	const x = Math.min(marquee.from.x, marquee.to.x);
	const y = Math.min(marquee.from.y, marquee.to.y);
	const width = Math.abs(marquee.to.x - marquee.from.x);
	const height = Math.abs(marquee.to.y - marquee.from.y);
	ctx.fillStyle = 'rgba(13, 153, 255, 0.1)';
	ctx.strokeStyle = '#0d99ff';
	ctx.lineWidth = 1;
	ctx.fillRect(x, y, width, height);
	ctx.strokeRect(x, y, width, height);
}
