// The advanced vector edits of issue #62, on top of the edit mode (editTool.ts): the bend tool
// (hold Ctrl), handle drags with mirroring (Alt breaks it for one drag), the mirroring mode and
// corner radius of selected vertices, and the paint bucket (B). The maths is in handles.ts.

import type { Paint, VectorNetwork } from '../document/types';
import type { ToolPointerEvent } from '../tools/protocol';
import type { EditGesture, VectorHit } from './editState';
import type { VectorEditor } from './editTool';
import { regionAt, type Point } from './geometry';
import {
	bendSegment,
	bendVertex,
	dragHandle,
	hasHandles,
	removeHandles,
	setMirroring,
	type HandleMirroring
} from './handles';
import { paintRegion, setCornerRadius } from './network';

const DEFAULT_BUCKET_COLOR = { r: 0.31, g: 0.61, b: 1 };

/** Ctrl (Cmd on macOS) turns the edit mode into the bend tool. */
export function isBendHeld(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
	return event.ctrlKey || event.metaKey;
}

/** Starts an advanced gesture; false when the press belongs to the plain edit mode. */
export function pressAdvanced(
	editor: VectorEditor,
	network: VectorNetwork,
	hit: VectorHit | null,
	local: Point,
	event: ToolPointerEvent
): boolean {
	const { state } = editor;
	if (state.bucket) {
		paintRegionAt(editor, local);
		return true;
	}
	if (hit?.kind === 'handle') return pressHandle(editor, network, hit, local, event);
	if (!isBendHeld(event) || !hit) return false;
	if (hit.kind === 'vertex') {
		state.selectVertices([hit.index], false);
		state.gesture = { kind: 'bend-vertex', vertex: hit.index, base: network, start: local };
		return true;
	}
	if (hit.kind === 'segment') {
		state.gesture = {
			kind: 'bend-segment',
			segment: hit.index,
			t: hit.t,
			base: network,
			start: local
		};
		return true;
	}
	return false;
}

function pressHandle(
	editor: VectorEditor,
	network: VectorNetwork,
	hit: Extract<VectorHit, { kind: 'handle' }>,
	local: Point,
	event: ToolPointerEvent
): boolean {
	if (isBendHeld(event)) {
		toggleStraightMirrored(editor, network, hit.vertex);
		return true;
	}
	editor.state.gesture = {
		kind: 'handle',
		segment: hit.segment,
		vertex: hit.vertex,
		base: network,
		start: local
	};
	return true;
}

/** Ctrl+click on a handle: mirrored (both handles stay opposite) or independent (straight). */
function toggleStraightMirrored(
	editor: VectorEditor,
	network: VectorNetwork,
	vertex: number
): void {
	const mode = network.vertices[vertex].handleMirroring;
	const next: HandleMirroring = mode === 'ANGLE_AND_LENGTH' ? 'NONE' : 'ANGLE_AND_LENGTH';
	editor.commit('Set handle mirroring', setMirroring(network, new Set([vertex]), next));
}

/** Updates the preview of a handle or bend drag; false for gestures that are not advanced. */
export function dragAdvanced(
	editor: VectorEditor,
	gesture: EditGesture,
	local: Point,
	breakMirroring: boolean
): boolean {
	const { state } = editor;
	if (gesture.kind === 'handle') {
		const origin = gesture.base.vertices[gesture.vertex];
		const tangent = { x: local.x - origin.x, y: local.y - origin.y };
		state.preview = dragHandle(
			gesture.base,
			gesture.segment,
			gesture.vertex,
			tangent,
			breakMirroring
		);
		return true;
	}
	if (gesture.kind === 'bend-vertex') {
		const origin = gesture.base.vertices[gesture.vertex];
		state.preview = bendVertex(gesture.base, gesture.vertex, {
			x: local.x - origin.x,
			y: local.y - origin.y
		});
		return true;
	}
	if (gesture.kind === 'bend-segment') {
		const delta = { x: local.x - gesture.start.x, y: local.y - gesture.start.y };
		state.preview = bendSegment(gesture.base, gesture.segment, gesture.t, delta);
		return true;
	}
	return false;
}

/** Commits an advanced gesture on release (a bend click on a vertex removes its handles). */
export function releaseAdvanced(
	editor: VectorEditor,
	gesture: EditGesture,
	result: 'click' | 'drag' | 'none'
): void {
	if (gesture.kind === 'move' || gesture.kind === 'marquee') return;
	const preview = editor.state.preview;
	if (result === 'drag' && preview) {
		editor.commit(labelOf(gesture), preview);
		return;
	}
	if (gesture.kind !== 'bend-vertex' || result !== 'click') return;
	if (!hasHandles(gesture.base, gesture.vertex)) return;
	editor.commit('Remove handles', removeHandles(gesture.base, gesture.vertex));
}

function labelOf(gesture: EditGesture): string {
	if (gesture.kind === 'handle') return 'Move handle';
	if (gesture.kind === 'bend-vertex') return 'Bend vertex';
	if (gesture.kind === 'bend-segment') return 'Bend segment';
	return 'Edit vector';
}

// ---------- vertex properties (inspector section) ----------

export function setMirroringOnSelection(editor: VectorEditor, mode: HandleMirroring): void {
	const network = editor.network();
	if (!network || editor.state.selectedVertices.size === 0) return;
	editor.commit('Set handle mirroring', setMirroring(network, editor.state.selectedVertices, mode));
}

export function setRadiusOnSelection(editor: VectorEditor, radius: number): void {
	const network = editor.network();
	if (!network || editor.state.selectedVertices.size === 0) return;
	if (!Number.isFinite(radius) || radius < 0) return;
	editor.commit(
		'Set corner radius',
		setCornerRadius(network, editor.state.selectedVertices, radius)
	);
}

/** The shared mirroring mode of the selected vertices, or null when they differ. */
export function selectedMirroring(editor: VectorEditor): HandleMirroring | null {
	const network = editor.network();
	if (!network) return null;
	const modes = new Set<HandleMirroring>();
	for (const vertex of editor.state.selectedVertices) {
		modes.add(network.vertices[vertex]?.handleMirroring ?? 'NONE');
	}
	if (modes.size !== 1) return null;
	return [...modes][0];
}

/** The shared corner radius of the selected vertices, or null when they differ. */
export function selectedRadius(editor: VectorEditor): number | null {
	const network = editor.network();
	if (!network) return null;
	const radii = new Set<number>();
	for (const vertex of editor.state.selectedVertices) {
		radii.add(network.vertices[vertex]?.cornerRadius ?? 0);
	}
	if (radii.size !== 1) return null;
	return [...radii][0];
}

// ---------- paint bucket ----------

function bucketPaint(editor: VectorEditor): Paint {
	const node = editor.node();
	const existing = node?.fills.find((paint) => paint.visible && paint.type === 'SOLID');
	let color = DEFAULT_BUCKET_COLOR;
	if (existing && existing.type === 'SOLID') color = existing.color;
	return { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color };
}

/** B: clicking a region fills it with the vector's fill colour; clicking a filled region clears it. */
export function paintRegionAt(editor: VectorEditor, local: Point): void {
	const network = editor.network();
	if (!network) return;
	const index = regionAt(network, local);
	if (index < 0) return;
	const filled = (network.regions?.[index].fills ?? []).length > 0;
	const fills = filled ? undefined : [bucketPaint(editor)];
	editor.commit(filled ? 'Clear region fill' : 'Fill region', paintRegion(network, index, fills));
}

export function toggleBucket(editor: VectorEditor): void {
	editor.state.bucket = !editor.state.bucket;
	editor.state.hover = null;
	editor.state.revision.bump();
}

export function regionHover(editor: VectorEditor, local: Point): VectorHit | null {
	const network = editor.network();
	if (!network) return null;
	const index = regionAt(network, local);
	if (index < 0) return null;
	return { kind: 'region', index };
}
