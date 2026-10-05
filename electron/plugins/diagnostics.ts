// main-diagnostics: keeps what a bug report needs (the newest main and renderer log lines), serves
// it as `diagnostics:read`, restarts the window in or out of safe mode, and deals with a renderer
// that crashed or hangs.
//
// Recovery. Every committed transaction is already persisted (autosave), so reloading loses at
// most the debounce window. A crashed window reloads onto the file it had open: its file is
// queued as the launch request.

import { Logger, LoggerLevel, type Exporter, type Plugin } from '@neoworks/extension-system';
import type { DiagnosticsReport } from '../bridge';
import type { WindowHandle } from '../kernel/host';
import { route } from '../kernel/route';

export const MAX_LOG_LINES = 500;

/** The newest `limit` lines, oldest first. */
export class LogBuffer {
	private lines: string[] = [];

	constructor(private readonly limit: number = MAX_LOG_LINES) {}

	push(line: string): void {
		this.lines.push(line);
		if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
	}

	snapshot(): string[] {
		return [...this.lines];
	}

	clear(): void {
		this.lines = [];
	}
}

const RELOAD_CHOICE = 0;
const SAFE_MODE_CHOICE = 1;
const QUIT_CHOICE = 2;
const WAIT_CHOICE = 1;

export const mainDiagnosticsPlugin: Plugin.Object = {
	name: 'main-diagnostics',
	inject: ['electron', 'ipc', 'windows', 'files'],
	apply(ctx) {
		const mainLog = new LogBuffer();
		const rendererLog = new LogBuffer();

		const exporter: Exporter = {
			colors: false,
			levels: { default: LoggerLevel.INFO },
			export: (message) => mainLog.push(`[${message.name}] ${Logger.format(exporter, message)}`)
		};
		ctx.logger.exporter(exporter);
		ctx.effect(
			() => () => {
				mainLog.clear();
				rendererLog.clear();
			},
			'main-diagnostics:buffers'
		);

		ctx.on('windows/renderer-message', (_window, level, message) => {
			rendererLog.push(`[${level}] ${message}`);
		});

		const asking = new Set<number>();
		const askOnce = async (window: WindowHandle, ask: () => Promise<void>): Promise<void> => {
			if (asking.has(window.id)) return;
			asking.add(window.id);
			try {
				await ask();
			} finally {
				asking.delete(window.id);
			}
		};

		const rememberFile = (window: WindowHandle): void => {
			const file = ctx.files.openFileOf(window.sender);
			if (file !== null) ctx.files.queueLaunch(file);
		};

		ctx.on('windows/renderer-gone', (window, reason, exitCode) => {
			rendererLog.push(`[gone] renderer process ended: ${reason} (exit ${exitCode})`);
			if (reason === 'clean-exit') return;
			void askOnce(window, async () => {
				rememberFile(window);
				const choice = await ctx.electron.dialog.showMessageBox({
					message: 'The window stopped working.',
					detail:
						'Your edits were saved as you made them. Reload to continue where you left off, ' +
						'or start with only the core plugins if it keeps happening.',
					buttons: ['Reload', 'Reload in safe mode', 'Quit'],
					defaultId: RELOAD_CHOICE,
					cancelId: QUIT_CHOICE
				});
				if (choice === QUIT_CHOICE) {
					ctx.electron.app.quit();
					return;
				}
				ctx.windows.reloadMainWindow(choice === SAFE_MODE_CHOICE);
			});
		});

		ctx.on('windows/renderer-unresponsive', (window) => {
			rendererLog.push('[unresponsive] the page stopped answering');
			void askOnce(window, async () => {
				const choice = await ctx.electron.dialog.showMessageBox({
					message: 'The window is not responding.',
					detail: 'Wait for it to recover, or reload it. Edits are saved as you make them.',
					buttons: ['Reload', 'Wait'],
					defaultId: WAIT_CHOICE,
					cancelId: WAIT_CHOICE
				});
				if (choice !== RELOAD_CHOICE) return;
				rememberFile(window);
				ctx.windows.reloadMainWindow(ctx.windows.safeMode);
			});
		});

		route(ctx, 'diagnostics:read', (): DiagnosticsReport => {
			const { app } = ctx.electron;
			return {
				app: {
					version: app.getVersion(),
					electron: process.versions.electron ?? 'none',
					chrome: process.versions.chrome ?? 'none',
					platform: app.platform,
					arch: process.arch,
					safeMode: ctx.windows.safeMode
				},
				main: mainLog.snapshot(),
				renderer: rendererLog.snapshot()
			};
		});

		route(ctx, 'diagnostics:restart', (request, event) => {
			const window = ctx.electron.windowFromSender(event.sender);
			if (window !== null) rememberFile(window);
			ctx.windows.reloadMainWindow(request.safeMode);
		});
	}
};
