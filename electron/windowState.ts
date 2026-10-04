import { app, screen, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
	fitToDisplays,
	parseWindowState,
	serializeWindowState,
	type WindowState
} from './windowBounds';

const SAVE_DELAY_MS = 400;

function stateFilePath(): string {
	return path.join(app.getPath('userData'), 'window-state.json');
}

function readRaw(): string | undefined {
	try {
		return fs.readFileSync(stateFilePath(), 'utf8');
	} catch {
		return undefined;
	}
}

/** Saved bounds that are safe to open with on the currently connected displays. */
export function loadWindowState(): WindowState {
	const displays = screen.getAllDisplays().map((display) => display.workArea);
	return fitToDisplays(parseWindowState(readRaw()), displays);
}

function currentState(window: BrowserWindow): WindowState {
	// getNormalBounds is the restored size, also while the window is maximized.
	const bounds = window.getNormalBounds();
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		maximized: window.isMaximized()
	};
}

function save(window: BrowserWindow): void {
	if (window.isDestroyed() || window.isMinimized()) return;
	try {
		fs.writeFileSync(stateFilePath(), serializeWindowState(currentState(window)));
	} catch {
		// A read-only profile must not break the app; the next launch uses the defaults.
	}
}

/** Persist bounds and maximized state while the window lives, and once more when it closes. */
export function trackWindowState(window: BrowserWindow): void {
	let timer: NodeJS.Timeout | undefined;
	const saveSoon = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => save(window), SAVE_DELAY_MS);
	};
	window.on('resize', saveSoon);
	window.on('move', saveSoon);
	window.on('maximize', saveSoon);
	window.on('unmaximize', saveSoon);
	window.on('close', () => {
		clearTimeout(timer);
		save(window);
	});
}
