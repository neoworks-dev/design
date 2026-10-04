import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	MAX_SCALE,
	MIN_SCALE,
	ZOOM_LADDER_PERCENT,
	clampScale,
	defaultCamera,
	fitCamera,
	nextZoomStop,
	panCamera,
	screenToWorld,
	unionRects,
	visibleWorldRect,
	worldToScreen,
	zoomCameraAt,
	type Camera
} from './camera';
import { wheelAction, type CanvasWheelEvent } from './wheel';

const cameraArbitrary = fc.record({
	x: fc.double({ min: -5000, max: 5000, noNaN: true }),
	y: fc.double({ min: -5000, max: 5000, noNaN: true }),
	scale: fc.double({ min: 0.02, max: 64, noNaN: true })
});
const pointArbitrary = fc.record({
	x: fc.double({ min: 0, max: 2000, noNaN: true }),
	y: fc.double({ min: 0, max: 2000, noNaN: true })
});

describe('camera', () => {
	it('maps world to screen and back', () => {
		fc.assert(
			fc.property(cameraArbitrary, pointArbitrary, (camera, point) => {
				const back = screenToWorld(camera, worldToScreen(camera, point));
				expect(back.x).toBeCloseTo(point.x, 6);
				expect(back.y).toBeCloseTo(point.y, 6);
			})
		);
	});

	it('zoom keeps the world point under the cursor fixed', () => {
		fc.assert(
			fc.property(
				cameraArbitrary,
				pointArbitrary,
				fc.double({ min: 0.02, max: 64, noNaN: true }),
				(camera, cursor, scale) => {
					const worldUnderCursor = screenToWorld(camera, cursor);
					const zoomed = zoomCameraAt(camera, cursor, scale);
					const after = worldToScreen(zoomed, worldUnderCursor);
					expect(after.x).toBeCloseTo(cursor.x, 5);
					expect(after.y).toBeCloseTo(cursor.y, 5);
				}
			)
		);
	});

	it('zooming in at a concrete cursor follows newOffset = cursor - (cursor - offset) * ratio', () => {
		const camera: Camera = { x: 100, y: 50, scale: 1 };
		const zoomed = zoomCameraAt(camera, { x: 300, y: 200 }, 2);
		expect(zoomed).toEqual({ x: 300 - (300 - 100) * 2, y: 200 - (200 - 50) * 2, scale: 2 });
	});

	it('clamps the scale to the supported range and zooms around the anchor for the clamped value', () => {
		expect(clampScale(1000)).toBe(MAX_SCALE);
		expect(clampScale(0)).toBe(MIN_SCALE);
		const zoomed = zoomCameraAt(defaultCamera(), { x: 10, y: 10 }, 1e9);
		expect(zoomed.scale).toBe(MAX_SCALE);
	});

	it('panning moves the offset and never the scale', () => {
		expect(panCamera({ x: 1, y: 2, scale: 3 }, 10, -4)).toEqual({ x: 11, y: -2, scale: 3 });
	});

	it('the visible world rectangle is what the canvas shows', () => {
		const rect = visibleWorldRect({ x: -200, y: -100, scale: 2 }, { width: 800, height: 600 });
		expect(rect).toEqual({ x: 100, y: 50, width: 400, height: 300 });
	});
});

describe('fitCamera', () => {
	const size = { width: 1000, height: 800 };
	const rect = { x: 500, y: -300, width: 2000, height: 600 };

	it('frames the rectangle with padding on every side, centred', () => {
		const camera = fitCamera(rect, size, { padding: 50, maxScale: MAX_SCALE });
		const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
		const bottomRight = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
		// width is the limiting axis: 1000 - 2 * 50 = 900 pixels for 2000 world units
		expect(camera.scale).toBeCloseTo(0.45, 9);
		expect(topLeft.x).toBeCloseTo(50, 6);
		expect(size.width - bottomRight.x).toBeCloseTo(50, 6);
		expect(topLeft.y - 0).toBeCloseTo(size.height - bottomRight.y, 6);
		expect(topLeft.y).toBeGreaterThanOrEqual(50);
	});

	it('always fits inside the padded canvas', () => {
		fc.assert(
			fc.property(
				fc.record({
					x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
					y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
					width: fc.double({ min: 1, max: 1e4, noNaN: true }),
					height: fc.double({ min: 1, max: 1e4, noNaN: true })
				}),
				(target) => {
					const camera = fitCamera(target, size, { padding: 40, maxScale: MAX_SCALE });
					const topLeft = worldToScreen(camera, { x: target.x, y: target.y });
					const bottomRight = worldToScreen(camera, {
						x: target.x + target.width,
						y: target.y + target.height
					});
					if (camera.scale <= MIN_SCALE) return;
					expect(topLeft.x).toBeGreaterThanOrEqual(40 - 1e-6);
					expect(topLeft.y).toBeGreaterThanOrEqual(40 - 1e-6);
					expect(bottomRight.x).toBeLessThanOrEqual(size.width - 40 + 1e-6);
					expect(bottomRight.y).toBeLessThanOrEqual(size.height - 40 + 1e-6);
				}
			)
		);
	});

	it('does not zoom past maxScale for small content', () => {
		const camera = fitCamera({ x: 0, y: 0, width: 10, height: 10 }, size, {
			padding: 10,
			maxScale: 1
		});
		expect(camera.scale).toBe(1);
	});
});

describe('zoom ladder', () => {
	it('has the stops from the issue, ascending', () => {
		expect(ZOOM_LADDER_PERCENT.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(ZOOM_LADDER_PERCENT).toContain(100);
		expect(ZOOM_LADDER_PERCENT[ZOOM_LADDER_PERCENT.length - 1]).toBe(25600);
		const sorted = [...ZOOM_LADDER_PERCENT].sort((a, b) => a - b);
		expect(ZOOM_LADDER_PERCENT).toEqual(sorted);
	});

	it('steps to the next stop in each direction from on a stop and from between stops', () => {
		expect(nextZoomStop(1, 'in')).toBe(1.5);
		expect(nextZoomStop(1, 'out')).toBe(0.66);
		expect(nextZoomStop(0.7, 'in')).toBe(1);
		expect(nextZoomStop(0.7, 'out')).toBe(0.66);
		expect(nextZoomStop(0.0625, 'in')).toBe(0.08);
	});

	it('stays at the ends of the ladder', () => {
		expect(nextZoomStop(256, 'in')).toBe(256);
		expect(nextZoomStop(0.01, 'out')).toBe(0.01);
	});
});

describe('unionRects', () => {
	it('is null for nothing and the bounding box otherwise', () => {
		expect(unionRects([])).toBeNull();
		expect(
			unionRects([
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 20, y: -5, width: 5, height: 5 }
			])
		).toEqual({ x: 0, y: -5, width: 25, height: 15 });
	});
});

function wheelEvent(overrides: Partial<CanvasWheelEvent>): CanvasWheelEvent {
	return {
		deltaX: 0,
		deltaY: 0,
		deltaMode: 0,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		screen: { x: 100, y: 100 },
		preventDefault: () => {},
		...overrides
	};
}

describe('wheelAction', () => {
	const size = { width: 800, height: 600 };

	it('pans against the scroll direction', () => {
		expect(wheelAction(wheelEvent({ deltaX: 5, deltaY: 30 }), size)).toEqual({
			kind: 'pan',
			deltaX: -5,
			deltaY: -30
		});
	});

	it('shift moves the camera sideways with the vertical delta', () => {
		expect(wheelAction(wheelEvent({ deltaY: 30, shiftKey: true }), size)).toEqual({
			kind: 'pan',
			deltaX: -30,
			deltaY: 0
		});
	});

	it('ctrl zooms to the cursor: scrolling up zooms in, down zooms out', () => {
		const up = wheelAction(wheelEvent({ deltaY: -100, ctrlKey: true }), size);
		const down = wheelAction(wheelEvent({ deltaY: 100, ctrlKey: true }), size);
		expect(up.kind).toBe('zoom');
		if (up.kind !== 'zoom' || down.kind !== 'zoom') return;
		expect(up.factor).toBeGreaterThan(1);
		expect(down.factor).toBeLessThan(1);
		expect(up.anchor).toEqual({ x: 100, y: 100 });
	});

	it('a small pinch delta zooms gently and a huge one is capped', () => {
		const pinch = wheelAction(wheelEvent({ deltaY: -4, ctrlKey: true }), size);
		const huge = wheelAction(wheelEvent({ deltaY: -5000, ctrlKey: true }), size);
		if (pinch.kind !== 'zoom' || huge.kind !== 'zoom') throw new Error('expected zoom');
		expect(pinch.factor).toBeLessThan(1.02);
		expect(huge.factor).toBeCloseTo(Math.exp(0.25), 9);
	});

	it('converts line and page deltas to pixels', () => {
		expect(wheelAction(wheelEvent({ deltaY: 3, deltaMode: 1 }), size)).toMatchObject({
			deltaY: -48
		});
		expect(wheelAction(wheelEvent({ deltaY: 1, deltaMode: 2 }), size)).toMatchObject({
			deltaY: -600
		});
	});
});
