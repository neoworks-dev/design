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

import type { BootReport } from './boot.svelte';
import type {
	AppendRequest,
	ApplyMeta,
	Change,
	DocumentChangeEvent,
	DocumentReplaceEvent
} from '../document';
import type { Size } from './types';
import type { StoreInfo } from '../../../electron/bridge';

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

		/** Dispatch mode: emit. The tool in use changed (activation, temporary tool, revert). */
		'tools/change'(toolId: string, previousToolId: string): void;

		/** Dispatch mode: emit. The built-in plugins finished booting; `report` says how each went. */
		'kernel/booted'(report: BootReport): void;

		/**
		 * Dispatch mode: emit. The list of available fonts changed (system fonts listed); text
		 * that was drawn with a fallback should be laid out again.
		 */
		'fonts/changed'(): void;

		/** Dispatch mode: emit. The window's document file changed (open, new, Save As). */
		'file/attached'(info: StoreInfo): void;

		/** Dispatch mode: emit. The canvas region changed size (viewport listens). */
		'canvas/resize'(size: Size): void;

		/**
		 * Dispatch mode: waterfall. Fired before `document.apply` validates a change list. A
		 * listener may veto by throwing or rewrite the list by transforming `next()`'s result.
		 * Call as `ctx.waterfall('document/before-apply', changes, meta, () => changes)`.
		 */
		'document/before-apply'(changes: Change[], meta: ApplyMeta, next: () => Change[]): Change[];

		/**
		 * Dispatch mode: waterfall. Fired after changes applied, so reflow and component sync can
		 * append derived changes to the triggering transaction (one undo step). A listener returns
		 * `[...next(), ...mine]`; appended changes are reported with origin `sync`.
		 */
		'document/append'(request: AppendRequest, next: () => Change[]): Change[];

		/**
		 * Dispatch mode: emit. A batch (one `apply` or one `transaction()`) is about to apply its
		 * first change; the document is still unchanged. History captures the selection here.
		 */
		'document/begin'(meta: ApplyMeta): void;

		/** Dispatch mode: emit. A transaction was committed. The one source of document change news. */
		'document/change'(event: DocumentChangeEvent): void;

		/** Dispatch mode: emit. The whole document was replaced (new, open): drop derived state. */
		'document/replace'(event: DocumentReplaceEvent): void;

		/** Dispatch mode: emit. The current page changed. */
		'document/currentpagechange'(pageId: string, previousPageId: string | null): void;

		/** Dispatch mode: emit. The undo or redo stack changed (canUndo, canRedo, entries). */
		'history/change'(): void;

		/** Dispatch mode: emit. The selection set changed; fires once per change. */
		'selection/change'(ids: readonly string[], previousIds: readonly string[]): void;
	}
}
