import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNode } from '../../lib/document';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { networkSignedDistance } from '../../lib/vector/geometry';
import type { Point, ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import overlay from '../overlay';
import toolPencil from './index';

const fakeViewport = {
	name: 'fake-viewport',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('viewport', { camera: { x: 0, y: 0, scale: 1 }, zoom: 1 })
} as Plugin;

function providers(): Plugin[] {
	return [...editingProviders(), coreTools, fakeViewport, overlay];
}

describePlugin('tool-pencil', toolPencil, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('pencil')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('shift+p');
		expect(ctx.overlay.contributions().map((entry) => entry.id)).toContain('tool-pencil/stroke');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountPencil(tolerance?: number): Promise<Context> {
	await mounted?.cleanup();
	const config = tolerance === undefined ? undefined : { tolerance };
	mounted = await mountPlugin(toolPencil, { providers: providers(), config });
	mounted.ctx.tools.activate('pencil');
	return mounted.ctx;
}

function pointer(point: Point, coalesced?: Point[]): ToolPointerEvent {
	return {
		screen: point,
		world: point,
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		coalesced
	};
}

function wave(): Point[] {
	const points: Point[] = [];
	for (let step = 0; step <= 60; step += 1) {
		points.push({ x: 700 + step * 4, y: 700 + Math.sin(step / 6) * 30 });
	}
	return points;
}

function draw(ctx: Context, points: Point[]): void {
	ctx.tools.pointerDown(pointer(points[0]));
	for (const point of points.slice(1)) ctx.tools.pointerMove(pointer(point));
	ctx.tools.pointerUp(pointer(points[points.length - 1]));
}

function vectors(ctx: Context): ReturnType<Context['document']['query']> {
	return ctx.document.query((node) => node.type === 'VECTOR');
}

function segmentCount(ctx: Context): number {
	const [node] = vectors(ctx);
	if (node.type !== 'VECTOR') throw new Error('no vector');
	return node.network.segments.length;
}

describe('pencil tool', () => {
	it('fits a freehand stroke into one stroked vector node and one undo step', async () => {
		const ctx = await mountPencil();
		const points = wave();
		draw(ctx, points);
		const [node] = vectors(ctx);
		expect(node.type).toBe('VECTOR');
		if (node.type !== 'VECTOR') return;
		expect(node.strokes).toHaveLength(1);
		expect(node.fills).toHaveLength(0);
		expect(node.network.segments.length).toBeGreaterThan(0);
		expect(node.network.segments.length).toBeLessThan(points.length / 3);
		expect(parseNode(node).ok).toBe(true);
		expect(ctx.selection.ids).toEqual([node.id]);
		expect(ctx.history.undo()).toBe(true);
		expect(vectors(ctx)).toHaveLength(0);
	});

	it('the stored curve stays within the tolerance of the input points', async () => {
		for (const tolerance of [1, 4]) {
			const ctx = await mountPencil(tolerance);
			const points = wave();
			draw(ctx, points);
			const [node] = vectors(ctx);
			if (node.type !== 'VECTOR') throw new Error('no vector');
			const bounds = ctx.document.absoluteBounds(node.id);
			const worst = Math.max(
				...points.map((point) =>
					Math.abs(
						networkSignedDistance(node.network, { x: point.x - bounds.x, y: point.y - bounds.y })
					)
				)
			);
			expect(worst).toBeLessThanOrEqual(tolerance);
		}
	});

	it('a looser tolerance gives fewer segments', async () => {
		const tight = await mountPencil(0.5);
		draw(tight, wave());
		const tightCount = segmentCount(tight);
		const loose = await mountPencil(6);
		draw(loose, wave());
		expect(segmentCount(loose)).toBeLessThan(tightCount);
	});

	it('uses the coalesced samples of a move event', async () => {
		const ctx = await mountPencil();
		ctx.tools.pointerDown(pointer({ x: 700, y: 700 }));
		ctx.tools.pointerMove(
			pointer({ x: 760, y: 700 }, [
				{ x: 720, y: 700 },
				{ x: 740, y: 730 },
				{ x: 760, y: 700 }
			])
		);
		ctx.tools.pointerUp(pointer({ x: 760, y: 700 }));
		const [node] = vectors(ctx);
		expect(ctx.document.absoluteBounds(node.id).height).toBeGreaterThan(10);
	});

	it('a click without movement creates nothing and Esc cancels a stroke', async () => {
		const ctx = await mountPencil();
		draw(ctx, [{ x: 700, y: 700 }]);
		expect(vectors(ctx)).toHaveLength(0);
		ctx.tools.pointerDown(pointer({ x: 700, y: 700 }));
		ctx.tools.pointerMove(pointer({ x: 760, y: 740 }));
		expect(ctx.tools.cancel()).toBe(true);
		ctx.tools.pointerUp(pointer({ x: 760, y: 740 }));
		expect(vectors(ctx)).toHaveLength(0);
	});
});
