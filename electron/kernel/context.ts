// The main process's kernel: a root Context of its own, never shared with the renderer's. Main
// plugins attach app lifecycle, windows, the protocol and IPC domains to it through effects, so
// disposing the root fiber unwinds everything (see plugins/app.ts for the shutdown path).

import { Context, Logger, LoggerLevel, type Exporter } from '@neoworks/extension-system';
import type { ElectronService } from '../plugins/electron';
import type { IpcService } from '../plugins/ipc';
import type { WindowsService } from '../plugins/windows';

declare module '@neoworks/extension-system' {
	interface Events {
		/**
		 * Dispatch mode: parallel. The app is quitting; nothing has been unloaded yet. A listener
		 * returns a promise for work that must finish first (flushing open documents).
		 */
		'app/before-quit'(): void | Promise<void>;
	}
	interface Context {
		electron: ElectronService;
		ipc: IpcService;
		windows: WindowsService;
	}
}

export interface MainContextOptions {
	/** Where log lines go; defaults to stdout so `bun run qa logs` sees main and renderer in one place. */
	writeLine?: (line: string) => void;
	level?: LoggerLevel;
}

function writeToStdout(line: string): void {
	process.stdout.write(`${line}\n`);
}

export function createMainContext(options: MainContextOptions = {}): Context {
	const root = new Context();
	const writeLine = options.writeLine === undefined ? writeToStdout : options.writeLine;
	const level = options.level === undefined ? LoggerLevel.INFO : options.level;
	const exporter: Exporter = {
		colors: false,
		levels: { default: level },
		export: (message) => writeLine(`[main:${message.name}] ${Logger.format(exporter, message)}`)
	};
	root.logger.exporter(exporter);
	return root;
}
