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
import type { NodeId } from '../document/types';
import type { SurfaceResetReason } from '../renderer/surface';
import type { Camera } from '../viewport/camera';
import type { CanvasWheelEvent } from '../viewport/wheel';
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

		/** Dispatch mode: emit. The tool in use changed (activation, temporary tool, revert). */
		'tools/change'(toolId: string, previousToolId: string): void;

		/** Dispatch mode: emit. The built-in plugins finished booting; `report` says how each went. */
		'kernel/booted'(report: BootReport): void;

		/**
		 * Dispatch mode: emit. The list of available fonts changed (system fonts listed); text
		 * that was drawn with a fallback should be laid out again.
		 */
		'fonts/changed'(): void;

		/**
		 * Dispatch mode: emit. The canvas region changed size, in CSS pixels (viewport listens).
		 * Emitted by the workbench layout and by the renderer when it measures its canvas; equal
		 * sizes may arrive twice, listeners treat them as idempotent.
		 */
		'canvas/resize'(size: Size): void;

		/**
		 * Dispatch mode: emit. The renderer now shows another page (or none): a page switch, a new
		 * scene source or the document closing. The viewport swaps the per-page camera on it.
		 */
		'scene/page-change'(pageId: NodeId | null): void;

		/**
		 * Dispatch mode: emit. The camera changed (pan, zoom, page switch); listeners redraw
		 * anything positioned in screen space.
		 */
		'viewport/change'(camera: Camera): void;

		/**
		 * Dispatch mode: emit. A wheel or trackpad event over the canvas. A listener that acts on it
		 * calls `event.preventDefault()` (the viewport does for pan and zoom). The canvas input
		 * router will own this later.
		 */
		'canvas/wheel'(event: CanvasWheelEvent): void;

		/**
		 * Dispatch mode: emit. The user asked for a context menu on the canvas (right click). The
		 * canvas input router will own this; until then a listener opens the `canvas-empty` menu.
		 */
		'canvas/contextmenu'(event: MouseEvent): void;

		/**
		 * Dispatch mode: emit. The renderer's Skia surface was rebuilt (WebGL context restored or
		 * the canvas resized); everything drawn on it is gone and the next frame redraws it all.
		 */
		'renderer/surface-reset'(reason: SurfaceResetReason): void;

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
