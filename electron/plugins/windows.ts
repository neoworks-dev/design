// main-window: the `windows` service, the main window's lifecycle and the `window:*` IPC routes.
// The window is opened once Electron is ready, closed when the plugin unloads, and reopened on
// `activate` (macOS dock click) when none is left.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import { emitTo, route } from '../kernel/route';
import type { IpcInvokeEvent, WindowHandle } from '../kernel/host';

export const windowsConfigSchema = z.strictObject({
	/** Page the window loads: `app://design/` in production, the vite dev server in dev. */
	entryUrl: z.string(),
	/** Retry loading while the dev server is still booting, and open detached devtools. */
	devServer: z.boolean(),
	preloadPath: z.string(),
	/** `bun run qa` session: mirror the renderer console to stdout, keep devtools closed. */
	qaSession: z.boolean()
});
export type WindowsConfig = z.infer<typeof windowsConfigSchema>;

const LOAD_RETRY_ATTEMPTS = 30;
const LOAD_RETRY_DELAY_MS = 500;

export class WindowsService extends Service {
	private currentMainWindow: WindowHandle | null = null;

	constructor(
		ctx: Context,
		private readonly config: WindowsConfig
	) {
		super(ctx, 'windows');
	}

	get mainWindow(): WindowHandle | null {
		return this.currentMainWindow;
	}

	/** Open the main window for the lifetime of the calling fiber. */
	openMainWindow(): void {
		const { electron } = this.ctx;
		this.ctx.effect(() => {
			const window = electron.createWindow({
				width: 1440,
				height: 900,
				minWidth: 960,
				minHeight: 600,
				frame: false,
				backgroundColor: '#0b0b0d',
				preloadPath: this.config.preloadPath
			});
			this.currentMainWindow = window;
			return this.attachToWindow(window);
		}, 'main-window');
	}

	focusMainWindow(): void {
		const window = this.currentMainWindow;
		if (!window || window.isDestroyed()) return;
		if (window.isMinimized()) window.restore();
		window.focus();
	}

	/** Wire up one window; returns what undoes it. */
	private attachToWindow(window: WindowHandle): () => void {
		const { electron } = this.ctx;
		const removers: (() => void)[] = [];

		window.onNewWindowRequest((url) => {
			// External links open in the user's browser, never inside the app.
			if (url.startsWith('http://') || url.startsWith('https://'))
				void electron.shell.openExternal(url);
		});
		removers.push(window.on('closed', () => this.forgetWindow(window)));
		removers.push(window.on('maximize', () => emitTo(window, 'window:maximized', true)));
		removers.push(window.on('unmaximize', () => emitTo(window, 'window:maximized', false)));
		if (this.config.qaSession) removers.push(window.observeRenderer(consoleMirror));

		const stopLoading = this.loadEntry(window);
		if (this.config.devServer && !this.config.qaSession) window.openDevTools();

		return () => {
			stopLoading();
			for (const remove of removers) remove();
			if (!window.isDestroyed()) window.close();
			this.forgetWindow(window);
		};
	}

	private forgetWindow(window: WindowHandle): void {
		if (this.currentMainWindow === window) this.currentMainWindow = null;
	}

	/** Loads the entry page; the dev server may still be booting, so dev retries. */
	private loadEntry(window: WindowHandle): () => void {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const attemptLoad = (attempt: number): void => {
			window.loadURL(this.config.entryUrl).catch(() => {
				if (cancelled || !this.config.devServer || attempt >= LOAD_RETRY_ATTEMPTS) return;
				retryTimer = setTimeout(() => attemptLoad(attempt + 1), LOAD_RETRY_DELAY_MS);
			});
		};
		attemptLoad(0);
		return () => {
			cancelled = true;
			clearTimeout(retryTimer);
		};
	}
}

// Mirrors the renderer console into main's stdout, so one log holds both halves.
const consoleMirror = {
	consoleMessage(level: string, message: string): void {
		process.stdout.write(`[renderer:${level}] ${message}\n`);
	},
	gone(reason: string, exitCode: number): void {
		process.stdout.write(`[renderer:gone] ${reason} (exit ${exitCode})\n`);
	}
};

export const mainWindowPlugin: Plugin.Object<WindowsConfig> = {
	name: 'main-window',
	inject: ['electron', 'ipc'],
	Config: windowsConfigSchema,
	apply(ctx, config) {
		const windows = new WindowsService(ctx, config);
		const { electron } = ctx;

		ctx.effect(() => {
			let disposed = false;
			void electron.app.whenReady().then(() => {
				if (!disposed) windows.openMainWindow();
			});
			return () => {
				disposed = true;
			};
		}, 'main-window:open-when-ready');

		ctx.effect(() => {
			const reopen = (): void => {
				if (electron.windows().length === 0) windows.openMainWindow();
			};
			electron.app.on('activate', reopen);
			return () => electron.app.off('activate', reopen);
		}, 'main-window:activate');

		route(ctx, 'window:minimize', (_payload, event) => {
			requireWindow(ctx, event).minimize();
		});
		route(ctx, 'window:toggleMaximize', (_payload, event) => {
			const window = requireWindow(ctx, event);
			if (window.isMaximized()) {
				window.unmaximize();
			} else {
				window.maximize();
			}
			return window.isMaximized();
		});
		route(ctx, 'window:close', (_payload, event) => {
			requireWindow(ctx, event).close();
		});
	}
};

function requireWindow(ctx: Context, event: IpcInvokeEvent): WindowHandle {
	const window = ctx.electron.windowFromSender(event.sender);
	if (!window) throw new Error('no window for this sender');
	return window;
}
