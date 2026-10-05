import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { transformPoint } from '../document';
import { mountPlugin, type MountedPlugin } from '../kernel/testing';
import transformHandles from '../../plugins/transform-handles';
import { handleInteractionOf, selectionProviders } from './fixtures/selectionFixture';
import {
	angleAround,
	normalizeAngle,
	rotationAbout,
	rotationOf,
	snapRotation,
	toDegrees
} from './rotate';
import type { RotateGesture } from './rotateGesture';

const PLAIN = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const SHIFT = { ...PLAIN, shiftKey: true };

describe('rotation math', () => {
	it('rotates a point about a centre', () => {
		const matrix = rotationAbout({ x: 10, y: 10 }, Math.PI / 2);
		const point = transformPoint(matrix, 20, 10);
		expect(point.x).toBeCloseTo(10);
		expect(point.y).toBeCloseTo(20);
	});

	it('measures the angle around a centre', () => {
		expect(toDegrees(angleAround({ x: 0, y: 0 }, { x: 0, y: 5 }))).toBeCloseTo(90);
	});

	it('normalises angles into (-180, 180]', () => {
		expect(toDegrees(normalizeAngle((3 * Math.PI) / 2))).toBeCloseTo(-90);
		expect(toDegrees(normalizeAngle(-Math.PI))).toBeCloseTo(180);
	});

	it('snaps the resulting orientation to 15 degree steps', () => {
		const start = (7 * Math.PI) / 180;
		const delta = snapRotation(start, (20 * Math.PI) / 180);
		expect(toDegrees(start + delta)).toBeCloseTo(30);
		expect(toDegrees(snapRotation(0, (52 * Math.PI) / 180))).toBeCloseTo(45);
	});
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountRotation(): Promise<{ ctx: Context; rotation: RotateGesture }> {
	mounted = await mountPlugin(transformHandles, { providers: selectionProviders() });
	const rotation = handleInteractionOf(mounted.ctx, 'transform-handles/handles').rotation;
	if (rotation === undefined) throw new Error('rotation missing');
	return { ctx: mounted.ctx, rotation };
}

function degreesOf(ctx: Context, id: string): number {
	return toDegrees(rotationOf(ctx.document.absoluteTransform(id)));
}

describe('rotate gesture', () => {
	// L is 900,0 100x100: centre (950, 50). The pointer starts right of the centre.
	it('rotates a node about its own centre in one undo step', async () => {
		const { ctx, rotation } = await mountRotation();
		ctx.selection.select(['L']);
		expect(rotation.begin({ x: 1050, y: 50 })).toBe(true);
		rotation.update({ x: 1000, y: 100 }, PLAIN);
		rotation.update({ x: 950, y: 150 }, PLAIN);
		rotation.commit();
		expect(degreesOf(ctx, 'L')).toBeCloseTo(90);
		const centre = transformPoint(ctx.document.absoluteTransform('L'), 50, 50);
		expect(centre.x).toBeCloseTo(950);
		expect(centre.y).toBeCloseTo(50);
		expect(ctx.history.undoLabel).toBe('Rotate');
		ctx.history.undo();
		expect(degreesOf(ctx, 'L')).toBeCloseTo(0);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('Shift snaps to 15 degree steps', async () => {
		const { ctx, rotation } = await mountRotation();
		ctx.selection.select(['L']);
		rotation.begin({ x: 1050, y: 50 });
		rotation.update({ x: 950 + 100 * Math.cos(0.35), y: 50 + 100 * Math.sin(0.35) }, SHIFT);
		expect(degreesOf(ctx, 'L')).toBeCloseTo(15);
		rotation.commit();
	});

	it('rotates several nodes about the common centre', async () => {
		const { ctx, rotation } = await mountRotation();
		ctx.selection.select(['L', 'T']);
		// bounds 900,0 100x630: centre (950, 315)
		rotation.begin({ x: 1050, y: 315 });
		rotation.update({ x: 950, y: 415 }, PLAIN);
		rotation.commit();
		expect(degreesOf(ctx, 'L')).toBeCloseTo(90);
		expect(degreesOf(ctx, 'T')).toBeCloseTo(90);
		const topLeft = transformPoint(ctx.document.absoluteTransform('L'), 0, 0);
		expect(topLeft.x).toBeCloseTo(950 + 315);
		expect(topLeft.y).toBeCloseTo(315 - 50);
	});

	it('rotates a nested node through its parent space', async () => {
		const { ctx, rotation } = await mountRotation();
		ctx.selection.select(['kid']);
		// kid: absolute 520,20 50x50, centre (545, 45)
		rotation.begin({ x: 600, y: 45 });
		rotation.update({ x: 545, y: 100 }, PLAIN);
		rotation.commit();
		expect(degreesOf(ctx, 'kid')).toBeCloseTo(90);
		const centre = transformPoint(ctx.document.absoluteTransform('kid'), 25, 25);
		expect(centre.x).toBeCloseTo(545);
		expect(centre.y).toBeCloseTo(45);
	});

	it('cancel leaves no trace and locked nodes do not rotate', async () => {
		const { ctx, rotation } = await mountRotation();
		ctx.selection.select(['L']);
		rotation.begin({ x: 1050, y: 50 });
		rotation.update({ x: 950, y: 150 }, PLAIN);
		rotation.cancel();
		expect(degreesOf(ctx, 'L')).toBeCloseTo(0);
		expect(ctx.history.canUndo).toBe(false);
		ctx.selection.select(['locked']);
		expect(rotation.begin({ x: 0, y: 0 })).toBe(false);
	});
});
