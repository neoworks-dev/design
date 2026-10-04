import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WINDOW_STATE,
	fitToDisplays,
	parseWindowState,
	serializeWindowState,
	type Rect,
	type WindowState
} from './windowBounds';

const primary: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary: Rect = { x: 1920, y: 0, width: 1280, height: 1024 };

describe('parseWindowState', () => {
	it('falls back to defaults for missing, broken or incomplete data', () => {
		expect(parseWindowState(undefined)).toEqual(DEFAULT_WINDOW_STATE);
		expect(parseWindowState('{nope')).toEqual(DEFAULT_WINDOW_STATE);
		expect(parseWindowState('42')).toEqual(DEFAULT_WINDOW_STATE);
		expect(parseWindowState('{"width": "wide", "height": 700}')).toEqual(DEFAULT_WINDOW_STATE);
	});

	it('round-trips a saved state', () => {
		const saved: WindowState = { x: 100, y: 50, width: 1200, height: 800, maximized: true };
		expect(parseWindowState(serializeWindowState(saved))).toEqual(saved);
	});

	it('enforces the minimum size and omits a half-known position', () => {
		const state = parseWindowState('{"width": 100, "height": 100, "x": 5}');
		expect(state).toEqual({ width: 960, height: 600, maximized: false });
	});
});

describe('fitToDisplays', () => {
	it('keeps a position that is on a connected display', () => {
		const state: WindowState = { x: 2000, y: 100, width: 1000, height: 700, maximized: false };
		expect(fitToDisplays(state, [primary, secondary])).toEqual(state);
	});

	it('keeps a window that is only partly off screen but still grabbable', () => {
		const state: WindowState = { x: -400, y: 100, width: 1000, height: 700, maximized: false };
		expect(fitToDisplays(state, [primary])).toEqual(state);
	});

	it('drops the position when the monitor it was on is gone', () => {
		const state: WindowState = { x: 2100, y: 100, width: 1000, height: 700, maximized: true };
		expect(fitToDisplays(state, [primary])).toEqual({ width: 1000, height: 700, maximized: true });
	});

	it('drops the position when only a sliver is visible', () => {
		const state: WindowState = { x: 1900, y: 100, width: 1000, height: 700, maximized: false };
		expect(fitToDisplays(state, [primary])).toEqual({ width: 1000, height: 700, maximized: false });
	});

	it('shrinks a restored window that no longer fits the only display', () => {
		const state: WindowState = { x: 3000, y: 0, width: 2400, height: 1400, maximized: false };
		expect(fitToDisplays(state, [primary])).toEqual({
			width: 1920,
			height: 1080,
			maximized: false
		});
	});

	it('leaves a state without position alone', () => {
		expect(fitToDisplays(DEFAULT_WINDOW_STATE, [primary])).toEqual(DEFAULT_WINDOW_STATE);
	});
});
