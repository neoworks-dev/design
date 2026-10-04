// Event catalogue of the renderer kernel. Every core event is declared here with the dispatch
// mode it is meant to be called with, because the mode is part of an event's contract:
//
//   emit       fire and forget notification, listeners cannot influence the caller
//   parallel   async notification, all listeners at once, errors aggregated
//   serial     async chain, first non-nullish result wins
//   bail       sync chain, first non-nullish result wins (a veto returns a value)
//   waterfall  middleware: each listener receives `next` and may transform the result
//
// Fire an event with the matching method (`ctx.emit('command/run', ...)`), never another mode.
// Names are `<domain>/<verb>`; events of a plugin are prefixed with the plugin id.

import type { Size } from './types';

declare module '@neoworks/extension-system' {
	interface Events {
		/**
		 * Dispatch mode: bail. Fired before a command runs. A listener vetoes the run by returning
		 * a reason string; `undefined` lets it proceed.
		 */
		'command/before'(commandId: string, args: unknown): string | void;

		/** Dispatch mode: emit. A command started (telemetry, AI audit trail). */
		'command/run'(commandId: string, args: unknown): void;

		/** Dispatch mode: emit. A command threw or was vetoed; the run rejects with the same error. */
		'command/error'(commandId: string, args: unknown, error: unknown): void;

		/**
		 * Dispatch mode: emit. A panel tab was activated (shortcut, command or click); the layout
		 * reveals that sidebar if it is collapsed.
		 */
		'panels/tab-activated'(side: 'left' | 'right', tabId: string): void;

		/** Dispatch mode: emit. The canvas region changed size (viewport listens). */
		'canvas/resize'(size: Size): void;
	}
}
