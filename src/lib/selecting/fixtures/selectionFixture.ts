// Test fixtures for the selection tools: a scene with every selection case, the providers the
// tools need (a fake viewport at zoom 1, the real hit test, spatial index and snapping) and a
// pointer event builder.

import type { Context, Plugin } from '@neoworks/extension-system';
import coreTools from '../../../plugins/core-tools';
import hitTest from '../../../plugins/hit-test';
import snapping from '../../../plugins/snapping';
import spatial from '../../../plugins/spatial';
import type { DesignDocument, Paint } from '../../document';
import type { OverlayContribution } from '../../overlay/types';
import { OverlayRegistry } from '../../services/overlay';
import { buildDocument, frame, group, node, page, rectangle } from '../../document/fixtures';
import { at, editingProviders } from '../../editing/fixtures/editingFixture';
import { Registry } from '../../registries/registry.svelte';
import type { PointerClaimant } from '../../tools/claim';
import { HandleInteraction } from '../handleInteraction';
import type { ToolPointerEvent } from '../../tools/protocol';

const WHITE: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 1, g: 1, b: 1 }
};

function painted(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number
): ReturnType<typeof rectangle> {
	return rectangle({ id, name: id, transform: at(x, y), width, height, fills: [WHITE] });
}

/**
 * Page `p`:
 *   F      top-level frame 0,0 400x400
 *     G    group 10,10 120x50          (r1 at 10,10 50x50 and r2 at 80,10 50x50 on the page)
 *     NF   nested frame 200,200 100x100 (inner 210,210 30x30)
 *   F2     top-level frame 500,0 300x300 (kid at 520,20 50x50)
 *   L      loose rectangle 900,0 100x100
 *   locked 900,200 100x100 (locked), hidden 900,400 100x100 (hidden), T text 900,600 100x30
 */
export function selectionScene(): DesignDocument {
	return buildDocument([
		page(
			'Page',
			[
				frame(
					{ id: 'F', name: 'F', transform: at(0, 0), width: 400, height: 400, fills: [WHITE] },
					[
						group({ id: 'G', name: 'G', transform: at(10, 10), width: 120, height: 50 }, [
							painted('r1', 0, 0, 50, 50),
							painted('r2', 70, 0, 50, 50)
						]),
						frame(
							{
								id: 'NF',
								name: 'NF',
								transform: at(200, 200),
								width: 100,
								height: 100,
								fills: [WHITE]
							},
							[painted('inner', 10, 10, 30, 30)]
						)
					]
				),
				frame(
					{ id: 'F2', name: 'F2', transform: at(500, 0), width: 300, height: 300, fills: [WHITE] },
					[painted('kid', 20, 20, 50, 50)]
				),
				painted('L', 900, 0, 100, 100),
				rectangle({
					id: 'locked',
					name: 'locked',
					transform: at(900, 200),
					width: 100,
					height: 100,
					fills: [WHITE],
					locked: true
				}),
				rectangle({
					id: 'hidden',
					name: 'hidden',
					transform: at(900, 400),
					width: 100,
					height: 100,
					fills: [WHITE],
					visible: false
				}),
				node('TEXT', { id: 'T', name: 'T', transform: at(900, 600), width: 100, height: 30 })
			],
			{ id: 'p' }
		)
	]);
}

const fakeViewport: Plugin = {
	name: 'viewport',
	apply(ctx: Context): void {
		ctx.provide('viewport', {
			zoom: 1,
			camera: { x: 0, y: 0, scale: 1 },
			visibleRect: () => ({ x: -5000, y: -5000, width: 10000, height: 10000 }),
			worldToScreen: (point: { x: number; y: number }) => point,
			screenToWorld: (point: { x: number; y: number }) => point
		});
	}
};

// Stands in for the overlay plugin (snapping draws its guides through it).
export const fakeOverlay: Plugin = {
	name: 'overlay',
	apply(ctx: Context): void {
		const registry = new OverlayRegistry();
		ctx.provide('overlay', {
			registry,
			register: (contribution: OverlayContribution) => registry.register(contribution)
		});
	}
};

// Stands in for the canvas input router: just the claimant registry.
export const fakeCanvasInput: Plugin = {
	name: 'canvasInput',
	apply(ctx: Context): void {
		const claimants = new Registry<PointerClaimant>();
		ctx.provide('canvasInput', {
			claimants,
			claim: (claimant: PointerClaimant) => claimants.register(claimant)
		});
	}
};

export function selectionProviders(document: DesignDocument = selectionScene()): Plugin[] {
	return [
		...editingProviders(document),
		fakeViewport,
		fakeOverlay,
		fakeCanvasInput,
		coreTools,
		spatial,
		hitTest,
		snapping
	];
}

export interface PointerModifiers {
	shiftKey?: boolean;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	detail?: number;
}

export function pointerEvent(
	x: number,
	y: number,
	modifiers: PointerModifiers = {}
): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: modifiers.detail ?? 1,
		pointerId: 1,
		shiftKey: modifiers.shiftKey === true,
		altKey: modifiers.altKey === true,
		ctrlKey: modifiers.ctrlKey === true,
		metaKey: modifiers.metaKey === true
	};
}

export function pressAt(
	ctx: Context,
	x: number,
	y: number,
	modifiers: PointerModifiers = {}
): void {
	ctx.tools.pointerDown(pointerEvent(x, y, modifiers));
}

export function releaseAt(
	ctx: Context,
	x: number,
	y: number,
	modifiers: PointerModifiers = {}
): void {
	ctx.tools.pointerUp(pointerEvent(x, y, modifiers));
}

export function clickAt(
	ctx: Context,
	x: number,
	y: number,
	modifiers: PointerModifiers = {}
): void {
	pressAt(ctx, x, y, modifiers);
	releaseAt(ctx, x, y, modifiers);
}

export function dragFromTo(
	ctx: Context,
	from: [number, number],
	to: [number, number],
	modifiers: PointerModifiers = {}
): void {
	pressAt(ctx, from[0], from[1], modifiers);
	ctx.tools.pointerMove(pointerEvent(to[0], to[1], modifiers));
	releaseAt(ctx, to[0], to[1], modifiers);
}

/** The handle interaction a plugin registered with the (fake) canvas input router. */
export function handleInteractionOf(ctx: Context, id: string): HandleInteraction {
	const claimant: unknown = ctx.canvasInput.claimants.get(id);
	if (!(claimant instanceof HandleInteraction)) throw new Error(`no handles registered: ${id}`);
	return claimant;
}
