// main-window: the `windows` service, the main window's lifecycle and the `window:*` IPC routes.
// The window is opened once Electron is ready, closed when the plugin unloads, and reopened on
// `activate` (macOS dock click) when none is left.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import { emitTo, route } from '../kernel/route';
import type { IpcInvokeEvent, RendererObserver, WindowHandle, WindowOptions } from '../kernel/host';
import { MIN_WINDOW_SIZE } from '../windowBounds';
import { loadWindowState, trackWindowState } from '../windowState';

export const windowsConfigSchema = z.strictObject({
	/** Page the window loads: `app://design/` in production, the vite dev server in dev. */
	entryUrl: z.string(),
	/** Retry loading while the dev server is still booting, and open detached devtools. */
	devServer: z.boolean(),
	preloadPath: z.string(),
	/** `bun run qa` session: mirror the renderer console to stdout, keep devtools closed. */
	qaSession: z.boolean(),
	/** Start with only the core plugins in the renderer (the `safe=1` query parameter). */
	safeMode: z.boolean().optional()
});
export type WindowsConfig = z.infer<typeof windowsConfigSchema>;

/** The renderer's debug plugin looks for this query parameter (src/plugins/debug/enabled.ts). */
export const QA_QUERY_PARAMETER = 'qa';

/** The renderer's boot reads this query parameter and mounts only the core plugins. */
export const SAFE_MODE_QUERY_PARAMETER = 'safe';

/**
 * The page to load: in a QA session it carries `?qa=1`, which switches the debug hook on; in safe
 * mode `?safe=1`.
 */
export function entryUrlFor(config: WindowsConfig, safeMode: boolean = false): string {
	if (!config.qaSession && !safeMode) return config.entryUrl;
	const url = new URL(config.entryUrl);
	if (config.qaSession) url.searchParams.set(QA_QUERY_PARAMETER, '1');
	if (safeMode) url.searchParams.set(SAFE_MODE_QUERY_PARAMETER, '1');
	return url.toString();
}

const LOAD_RETRY_ATTEMPTS = 30;
const LOAD_RETRY_DELAY_MS = 500;

export class WindowsService extends Service {
	private currentMainWindow: WindowHandle | null = null;
	private currentSafeMode: boolean;

	constructor(
		ctx: Context,
		private readonly config: WindowsConfig
	) {
		super(ctx, 'windows');
		this.currentSafeMode = config.safeMode === true;
	}

	/** Whether the page was last loaded in safe mode. */
	get safeMode(): boolean {
		return this.currentSafeMode;
	}

	/** Load the entry page again, in safe mode or not. A crashed renderer comes back with it. */
	reloadMainWindow(safeMode: boolean): void {
		const window = this.currentMainWindow;
		if (!window || window.isDestroyed()) return;
		this.currentSafeMode = safeMode;
		window.loadURL(entryUrlFor(this.config, safeMode)).catch((error: unknown) => {
			this.ctx.logger.error(error);
		});
	}

	get mainWindow(): WindowHandle | null {
		return this.currentMainWindow;
	}

	/**
	 * Open the main window for the lifetime of the calling fiber, at the size, position and
	 * maximized state it had when it was last closed (fitted to the connected displays).
	 */
	openMainWindow(): void {
		const { electron } = this.ctx;
		this.ctx.effect(() => {
			const state = loadWindowState(electron);
			const options: WindowOptions = {
				width: state.width,
				height: state.height,
				minWidth: MIN_WINDOW_SIZE.width,
				minHeight: MIN_WINDOW_SIZE.height,
				...this.frameOptions(),
				backgroundColor: '#0b0b0d',
				preloadPath: this.config.preloadPath
			};
			if (state.x !== undefined && state.y !== undefined) {
				options.x = state.x;
				options.y = state.y;
			}
			const window = electron.createWindow(options);
			this.currentMainWindow = window;
			const detach = this.attachToWindow(window);
			if (state.maximized) window.maximize();
			return detach;
		}, 'main-window');
	}

	/** Frameless everywhere; macOS keeps its traffic lights over the (hidden) title bar. */
	private frameOptions(): Pick<WindowOptions, 'frame' | 'titleBarStyle'> {
		if (this.ctx.electron.app.platform === 'darwin') {
			return { frame: true, titleBarStyle: 'hidden' };
		}
		return { frame: false };
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
		removers.push(window.observeRenderer(this.rendererEvents(window)));
		removers.push(trackWindowState(window, electron));

		const stopLoading = this.loadEntry(window);
		if (this.config.devServer && !this.config.qaSession) window.openDevTools();

		return () => {
			stopLoading();
			for (const remove of removers) remove();
			if (!window.isDestroyed()) window.close();
			this.forgetWindow(window);
		};
	}

	/** Tells the kernel what the window's renderer does; diagnostics and recovery listen. */
	private rendererEvents(window: WindowHandle): RendererObserver {
		return {
			consoleMessage: (level, message) =>
				this.ctx.emit('windows/renderer-message', window, level, message),
			gone: (reason, exitCode) => this.ctx.emit('windows/renderer-gone', window, reason, exitCode),
			unresponsive: () => this.ctx.emit('windows/renderer-unresponsive', window),
			responsive: () => this.ctx.emit('windows/renderer-responsive', window)
		};
	}

	private forgetWindow(window: WindowHandle): void {
		if (this.currentMainWindow === window) this.currentMainWindow = null;
	}

	/** Loads the entry page; the dev server may still be booting, so dev retries. */
	private loadEntry(window: WindowHandle): () => void {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const entryUrl = entryUrlFor(this.config, this.currentSafeMode);
		const attemptLoad = (attempt: number): void => {
			window.loadURL(entryUrl).catch(() => {
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
		route(ctx, 'window:isMaximized', (_payload, event) => requireWindow(ctx, event).isMaximized());
	}
};

function requireWindow(ctx: Context, event: IpcInvokeEvent): WindowHandle {
	const window = ctx.electron.windowFromSender(event.sender);
	if (!window) throw new Error('no window for this sender');
	return window;
}
