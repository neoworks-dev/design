// Window state persistence for the main-window plugin, written against the host abstraction
// (`screen`, `userData`, `WindowHandle`) so it runs under the fake host in tests. The pure
// parts (parsing, multi-monitor fitting) are in windowBounds.ts.

import type { ElectronHost, WindowHandle } from './kernel/host';
import {
	fitToDisplays,
	parseWindowState,
	serializeWindowState,
	type WindowState
} from './windowBounds';

export const WINDOW_STATE_FILE = 'window-state.json';
export const SAVE_DELAY_MS = 400;

type StateHost = Pick<ElectronHost, 'screen' | 'userData'>;

/** Saved bounds that are safe to open with on the currently connected displays. */
export function loadWindowState(host: StateHost): WindowState {
	const saved = parseWindowState(host.userData.readText(WINDOW_STATE_FILE));
	return fitToDisplays(saved, host.screen.workAreas());
}

function currentState(window: WindowHandle): WindowState {
	// The normal bounds are the restored size, also while the window is maximized.
	const bounds = window.getNormalBounds();
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		maximized: window.isMaximized()
	};
}

function save(window: WindowHandle, host: StateHost): void {
	if (window.isDestroyed() || window.isMinimized()) return;
	try {
		host.userData.writeText(WINDOW_STATE_FILE, serializeWindowState(currentState(window)));
	} catch {
		// A read-only profile must not break the app; the next launch uses the defaults.
	}
}

/**
 * Persist bounds and maximized state while the window lives (debounced), and once more when it
 * closes. Returns what undoes it: the listeners and the pending timer go, after a final save
 * if the window is still alive.
 */
export function trackWindowState(window: WindowHandle, host: StateHost): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const saveSoon = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => save(window, host), SAVE_DELAY_MS);
	};
	const saveNow = (): void => {
		clearTimeout(timer);
		save(window, host);
	};
	const removers = [
		window.on('resize', saveSoon),
		window.on('move', saveSoon),
		window.on('maximize', saveSoon),
		window.on('unmaximize', saveSoon),
		window.on('close', saveNow)
	];
	return () => {
		saveNow();
		for (const remove of removers) remove();
	};
}
