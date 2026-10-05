// The pencil tool (issue #63): collect pointer samples (coalesced events included) while the
// button is down, fit cubic curves on release (fit.ts) and create one VECTOR node, one undo step.

import type { Context } from '@neoworks/extension-system';
import { identityMatrix } from '../document/matrix';
import type { OverlayContribution } from '../overlay/types';
import type { ToolContribution } from '../registries/tools.svelte';
import type { Point, ToolPointerEvent } from '../tools/protocol';
import { createVectorNode, newDraftSpace, worldToDraft, type DraftSpace } from './createVector';
import { fitFreehand } from './fit';
import { toScreen } from './overlayDraw';
import { Revision } from './revision.svelte';

const PRIMARY_BUTTON = 0;
const PENCIL_STROKE_WEIGHT = 2;
/** Samples closer than this many screen pixels to the previous one are dropped. */
const MINIMUM_STEP_PIXELS = 1;

export class PencilState {
	points: Point[] = [];
	space: DraftSpace | null = null;
	readonly revision = new Revision();
}

type PencilHandlers = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onCancel' | 'onDeactivate'
>;

export interface PencilOptions {
	/** Largest allowed deviation of the fitted curve from the drawn points, in screen pixels. */
	tolerance: () => number;
}

function addSample(ctx: Context, state: PencilState, world: Point): void {
	const previous = state.points.at(-1);
	if (previous) {
		const step = Math.hypot(world.x - previous.x, world.y - previous.y) * ctx.viewport.zoom;
		if (step < MINIMUM_STEP_PIXELS) return;
	}
	state.points.push(world);
}

function abandon(state: PencilState): void {
	state.points = [];
	state.space = null;
	state.revision.bump();
}

/** Fits the collected points and creates the vector; nothing when the stroke is too short. */
export function finishStroke(ctx: Context, state: PencilState, options: PencilOptions): void {
	const { space, points } = state;
	abandon(state);
	if (!space || points.length < 2) return;
	const local = points.map((point) => worldToDraft(space, point));
	const tolerance = options.tolerance() / ctx.viewport.zoom;
	const network = fitFreehand(local, tolerance);
	if (network.segments.length === 0) return;
	createVectorNode(ctx, network, space.container, {
		label: 'Draw with pencil',
		strokeWeight: PENCIL_STROKE_WEIGHT
	});
}

export function createPencilTool(
	ctx: Context,
	state: PencilState,
	options: PencilOptions
): PencilHandlers {
	return {
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON) return;
			state.space = newDraftSpace(ctx, event.world);
			state.points = [event.world];
			state.revision.bump();
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (!state.space) return;
			const samples = event.coalesced ?? [event.world];
			for (const sample of samples) addSample(ctx, state, sample);
			state.revision.bump();
		},
		onPointerUp(event: ToolPointerEvent): void {
			if (!state.space) return;
			addSample(ctx, state, event.world);
			finishStroke(ctx, state, options);
		},
		onCancel(): boolean {
			if (!state.space) return false;
			abandon(state);
			return true;
		},
		onDeactivate: () => abandon(state)
	};
}

/** Overlay: the raw stroke while it is drawn. */
export function pencilOverlay(state: PencilState): OverlayContribution {
	return {
		id: 'tool-pencil/stroke',
		order: 50,
		track: () => void state.revision.value,
		draw(frame): void {
			if (state.points.length < 2) return;
			const { ctx } = frame;
			ctx.strokeStyle = '#0d99ff';
			ctx.lineWidth = 1.5;
			ctx.lineJoin = 'round';
			ctx.beginPath();
			state.points.forEach((point, index) => {
				const screen = toScreen(frame, identityMatrix(), point);
				if (index === 0) ctx.moveTo(screen.x, screen.y);
				else ctx.lineTo(screen.x, screen.y);
			});
			ctx.stroke();
		}
	};
}
