// Pure logic of window state persistence: parsing what was saved and making sure it still lands
// on a screen. No electron import, so it is unit tested (windowBounds.test.ts).

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WindowState {
	width: number;
	height: number;
	/** Absent when there is nothing sensible to restore: the OS then places the window. */
	x?: number;
	y?: number;
	maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900, maximized: false };
export const MIN_WINDOW_SIZE = { width: 960, height: 600 };

// How much of the window must be on a screen so the user can still grab its title bar.
const MIN_VISIBLE = { width: 120, height: 40 };

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** Read a persisted JSON string; anything unusable yields the defaults. */
export function parseWindowState(raw: string | undefined): WindowState {
	if (raw === undefined) return DEFAULT_WINDOW_STATE;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_WINDOW_STATE;
	}
	if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WINDOW_STATE;
	const record = parsed as Record<string, unknown>;
	if (!isFiniteNumber(record.width) || !isFiniteNumber(record.height)) return DEFAULT_WINDOW_STATE;
	const state: WindowState = {
		width: Math.max(MIN_WINDOW_SIZE.width, Math.round(record.width)),
		height: Math.max(MIN_WINDOW_SIZE.height, Math.round(record.height)),
		maximized: record.maximized === true
	};
	if (isFiniteNumber(record.x) && isFiniteNumber(record.y)) {
		state.x = Math.round(record.x);
		state.y = Math.round(record.y);
	}
	return state;
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return { width: Math.max(0, width), height: Math.max(0, height) };
}

function isGrabbable(bounds: Rect, display: Rect): boolean {
	const visible = overlap(bounds, display);
	return visible.width >= MIN_VISIBLE.width && visible.height >= MIN_VISIBLE.height;
}

/**
 * Multi-monitor sanity check: keep the saved position only if enough of the window is on a
 * connected display (a monitor may have been unplugged since). Otherwise drop the position so
 * the OS centres the window, and shrink it to fit the primary display.
 */
export function fitToDisplays(state: WindowState, displays: Rect[]): WindowState {
	if (state.x === undefined || state.y === undefined) return state;
	const bounds: Rect = { x: state.x, y: state.y, width: state.width, height: state.height };
	if (displays.some((display) => isGrabbable(bounds, display))) return state;
	const primary = displays[0];
	const fitted: WindowState = {
		width: state.width,
		height: state.height,
		maximized: state.maximized
	};
	if (!primary) return fitted;
	fitted.width = Math.min(state.width, primary.width);
	fitted.height = Math.min(state.height, primary.height);
	return fitted;
}

export function serializeWindowState(state: WindowState): string {
	return JSON.stringify(state);
}
