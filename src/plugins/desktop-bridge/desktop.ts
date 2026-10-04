// The renderer's `desktop` service: `window.desktop` (the preload bridge) behind a service, so
// plugins `inject: ['desktop']` instead of touching the global and tests can provide a fake.
//
// Errors cross Electron's context bridge as plain `Error`s whose `name` and extra properties are
// dropped; only the message survives, as `CODE: text`. The service turns that back into a typed
// `DesktopError`.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	AppPathName,
	BootReport,
	DesktopBridge,
	IpcErrorCode,
	IpcEventChannel,
	IpcEvents,
	OpenFileOptions,
	SaveFileOptions
} from '../../../electron/bridge';

const ERROR_CODES: readonly IpcErrorCode[] = [
	'INVALID_PAYLOAD',
	'FORBIDDEN_SENDER',
	'HANDLER_FAILED',
	'UNKNOWN_CHANNEL'
];

export class DesktopError extends Error {
	constructor(
		readonly code: IpcErrorCode,
		message: string
	) {
		super(message);
		this.name = 'DesktopError';
	}
}

/** The typed error for a message of the form `CODE: text`, or `null` for any other error. */
export function parseBridgeError(error: unknown): DesktopError | null {
	if (!(error instanceof Error)) return null;
	const separator = error.message.indexOf(': ');
	if (separator < 0) return null;
	const code = ERROR_CODES.find((candidate) => candidate === error.message.slice(0, separator));
	if (!code) return null;
	return new DesktopError(code, error.message.slice(separator + 2));
}

async function typed<Value>(call: () => Promise<Value>): Promise<Value> {
	try {
		return await call();
	} catch (error) {
		const parsed = parseBridgeError(error);
		if (parsed) throw parsed;
		throw error;
	}
}

export class DesktopService extends Service {
	constructor(
		ctx: Context,
		private readonly bridge: DesktopBridge
	) {
		super(ctx, 'desktop');
	}

	get platform(): NodeJS.Platform {
		return this.bridge.system.platform;
	}

	get arch(): string {
		return this.bridge.system.arch;
	}

	minimizeWindow(): Promise<void> {
		return typed(() => this.bridge.window.minimize());
	}

	/** Resolves with whether the window is maximized afterwards. */
	toggleMaximizeWindow(): Promise<boolean> {
		return typed(() => this.bridge.window.toggleMaximize());
	}

	closeWindow(): Promise<void> {
		return typed(() => this.bridge.window.close());
	}

	version(): Promise<string> {
		return typed(() => this.bridge.app.version());
	}

	path(name: AppPathName): Promise<string> {
		return typed(() => this.bridge.app.path(name));
	}

	quit(): Promise<void> {
		return typed(() => this.bridge.app.quit());
	}

	/** What the main kernel booted; `null` until main finished booting. */
	mainBootReport(): Promise<BootReport | null> {
		return typed(() => this.bridge.app.bootReport());
	}

	openFileDialog(options?: OpenFileOptions): Promise<string[] | null> {
		return typed(() => this.bridge.dialogs.openFile(options));
	}

	saveFileDialog(options?: SaveFileOptions): Promise<string | null> {
		return typed(() => this.bridge.dialogs.saveFile(options));
	}

	/**
	 * Subscribe to a main-to-renderer push for the lifetime of the calling plugin: the
	 * subscription is a `ctx.effect` on the caller's context, so unmounting the caller
	 * unsubscribes. The returned function unsubscribes earlier.
	 */
	on<Channel extends IpcEventChannel>(
		channel: Channel,
		listener: (payload: IpcEvents[Channel]) => void
	): () => Promise<void> {
		return this.ctx.effect(() => this.bridge.events.on(channel, listener), `desktop:on:${channel}`);
	}
}
