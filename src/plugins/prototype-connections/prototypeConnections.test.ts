import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { at, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import {
	connectionCurve,
	distanceToCurve,
	handleCenter,
	hitsHandle
} from '../../lib/prototype/connections';
import {
	fakeCanvasInput,
	fakeOverlay,
	pointerEvent
} from '../../lib/selecting/fixtures/selectionFixture';
import type { PointerGrab } from '../../lib/tools/claim';
import corePanels from '../core-panels';
import prototypePanel from '../prototype-panel';
import prototypeConnections from './index';

const viewport: Plugin = {
	name: 'viewport',
	apply(ctx: Context): void {
		ctx.provide('viewport', {
			zoom: 1,
			camera: { x: 0, y: 0, scale: 1 },
			size: { width: 1000, height: 800 },
			worldToScreen: (point: { x: number; y: number }) => point,
			screenToWorld: (point: { x: number; y: number }) => point
		});
	}
};

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'home', name: 'Home', transform: at(0, 0), width: 200, height: 200 }, [
					rectangle({ id: 'button', name: 'Button', transform: at(20, 20), width: 100, height: 40 })
				]),
				frame({ id: 'detail', name: 'Detail', transform: at(400, 0), width: 200, height: 200 })
			],
			{ id: 'p' }
		)
	]);
}

function providers(): Plugin[] {
	return [
		...editingProviders(scene()),
		viewport,
		fakeOverlay,
		fakeCanvasInput,
		corePanels,
		prototypePanel
	];
}

describePlugin('prototype-connections', prototypeConnections, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.overlay.registry.list().map((entry) => entry.id)).toContain(
			'prototype-connections/draw'
		);
		expect(ctx.canvasInput.claimants.has('prototype-connections/handles')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function openPrototypeTab(): Promise<Context> {
	mounted = await mountPlugin(prototypeConnections, { providers: providers() });
	const { ctx } = mounted;
	ctx.panels.activateTab('prototype');
	ctx.selection.select(['button']);
	return ctx;
}

function claimAt(ctx: Context, x: number, y: number): PointerGrab | undefined {
	const event = pointerEvent(x, y);
	for (const claimant of ctx.canvasInput.claimants.list()) {
		const grab = claimant.claim(event);
		if (grab !== undefined) return grab;
	}
	return undefined;
}

describe('connection handle', () => {
	it('dragging the handle onto another frame creates a navigate interaction', async () => {
		const ctx = await openPrototypeTab();
		const handle = handleCenter({ x: 20, y: 20, width: 100, height: 40 });
		const grab = claimAt(ctx, handle.x, handle.y);
		expect(grab).toBeDefined();

		grab?.move(pointerEvent(450, 100));
		expect(ctx.prototyping.state.drag).toMatchObject({ sourceId: 'button', targetId: 'detail' });

		grab?.up(pointerEvent(450, 100));
		expect(ctx.prototyping.state.drag).toBeNull();
		expect(ctx.prototyping.connections()).toEqual([
			{ sourceId: 'button', reactionIndex: 0, destinationId: 'detail' }
		]);

		ctx.history.undo();
		expect(ctx.prototyping.connections()).toEqual([]);
	});

	it('releasing over nothing, or over the own frame, adds nothing', async () => {
		const ctx = await openPrototypeTab();
		const handle = handleCenter({ x: 20, y: 20, width: 100, height: 40 });
		const grab = claimAt(ctx, handle.x, handle.y);
		grab?.up(pointerEvent(100, 100));
		expect(ctx.prototyping.connections()).toEqual([]);
		expect(ctx.prototyping.reactions('button')).toHaveLength(0);
	});

	it('does not claim presses while the Design tab shows', async () => {
		const ctx = await openPrototypeTab();
		ctx.panels.registerTab({ id: 'design', side: 'right', title: 'Design', order: 0 });
		ctx.panels.activateTab('design');
		const handle = handleCenter({ x: 20, y: 20, width: 100, height: 40 });
		expect(claimAt(ctx, handle.x, handle.y)).toBeUndefined();
	});

	it('pressing an arrow selects it and Delete removes it', async () => {
		const ctx = await openPrototypeTab();
		ctx.prototyping.connect('button', 'detail');
		ctx.prototyping.selectConnection(null);
		const curve = connectionCurve(
			{ x: 20, y: 20, width: 100, height: 40 },
			{ x: 400, y: 0, width: 200, height: 200 }
		);
		const grab = claimAt(ctx, curve.start.x + 40, curve.start.y);
		expect(distanceToCurve(curve, { x: curve.start.x + 40, y: curve.start.y })).toBeLessThan(40);
		grab?.up(pointerEvent(0, 0));
		expect(ctx.prototyping.state.selectedConnection).toEqual({ nodeId: 'button', index: 0 });
		expect(ctx.prototyping.removeSelectedConnection()).toBe(true);
		expect(ctx.prototyping.connections()).toEqual([]);
	});
});

describe('geometry', () => {
	it('curves run between the facing sides and the handle sits outside the right edge', () => {
		const from = { x: 0, y: 0, width: 100, height: 100 };
		const to = { x: 300, y: 0, width: 100, height: 100 };
		const curve = connectionCurve(from, to);
		expect(curve.start).toEqual({ x: 100, y: 50 });
		expect(curve.end).toEqual({ x: 300, y: 50 });
		expect(hitsHandle(from, handleCenter(from))).toBe(true);
		expect(hitsHandle(from, { x: 50, y: 50 })).toBe(false);
	});
});
