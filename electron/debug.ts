import { app, type BrowserWindow } from 'electron';

// Switches used by `bun run qa` (scripts/qa.ts) to run an isolated, observable instance.
// None of them are set in normal use.

const userDataDirectory = process.env.DESIGN_USER_DATA_DIR;
export const isQaSession = process.env.DESIGN_QA === '1';

// Must run before app `ready`: keeps a QA instance off the user's real profile.
export function applyDebugPaths(): void {
	if (!userDataDirectory) return;
	app.setPath('userData', userDataDirectory);
}

// Mirrors the renderer console into main's stdout, so one log holds both halves.
export function forwardRendererConsole(window: BrowserWindow): void {
	if (!isQaSession) return;
	window.webContents.on('console-message', (event) => {
		process.stdout.write(`[renderer:${event.level}] ${event.message}\n`);
	});
	window.webContents.on('render-process-gone', (_event, details) => {
		process.stdout.write(`[renderer:gone] ${details.reason} (exit ${details.exitCode})\n`);
	});
}
