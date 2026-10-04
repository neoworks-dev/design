// The `history` service: undo and redo over committed transactions.
//
// Recording (wired by the plugin from document events):
//   document/begin   the selection as it is before the change, kept for undo
//   document/change  the transaction becomes an entry, folds into the open group, or coalesces
//                    into the previous entry when both carry the same `mergeKey` within the window
//   document/replace the history is dropped (a different document)
//
// Grouping: `group(options, run)` (async) or `beginGroup` / `endGroup` (a gesture: pointer down to
// up) fold every matching transaction into ONE entry: all of a plugin or AI run (`runId`), or all
// transactions while the group is open when it has no run id. A group whose run throws keeps what
// it applied as one undoable step.
//
// Undo applies `entry.undo` through `document.apply` with `meta.replay`, so persistence, events
// and derived data see it like any other change, but history does not record its own replay.
// Selection and viewport are not in the stack; the selection is restored as it was before.

import { Service, type Context } from '@neoworks/extension-system';
import {
	generateNodeId,
	invertChanges,
	type ApplyMeta,
	type ChangeOrigin,
	type DocumentChangeEvent,
	type Transaction
} from '../document';
import type { DocumentService } from './document';
import type {
	HistoryEntry,
	HistoryEntrySummary,
	HistoryState,
	OpenGroup
} from './historyState.svelte';
import type { SelectionService, SelectionSnapshot } from './selection';

declare module '@neoworks/extension-system' {
	interface Context {
		history: HistoryService;
	}
}

export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_MERGE_WINDOW_MS = 1000;

export interface HistoryOptions {
	/** Most undo steps kept; the oldest are dropped. */
	limit?: number;
	/** Transactions with the same `mergeKey` closer together than this coalesce. */
	mergeWindowMs?: number;
	/** Clock; tests inject a fake. */
	now?: () => number;
}

export interface GroupOptions {
	label: string;
	origin?: ChangeOrigin;
	/** Only transactions with this run id fold in; without it every transaction does. */
	runId?: string;
}

/** Returned by `beginGroup`; pass it back to `endGroup`. Ending twice does nothing. */
export interface GroupHandle {
	readonly id: string;
	closed: boolean;
}

export class HistoryError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'HistoryError';
	}
}

function summarize(entry: HistoryEntry): HistoryEntrySummary {
	return {
		id: entry.id,
		label: entry.label,
		origin: entry.origin,
		runId: entry.runId,
		timestamp: entry.timestamp,
		transactionCount: entry.transactionCount
	};
}

export class HistoryService extends Service {
	private readonly mergeWindowMs: number;
	private readonly now: () => number;

	/** Dependencies are captured from the providing plugin's ctx (it injects them). */
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly selection: SelectionService,
		private readonly state: HistoryState,
		options: HistoryOptions = {}
	) {
		super(ctx, 'history');
		this.state.limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
		this.mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
		this.now = options.now ?? Date.now;
	}

	// ---------- reads (reactive) ----------

	get canUndo(): boolean {
		return this.state.undoStack.length > 0 && !this.state.groupOpen;
	}

	get canRedo(): boolean {
		return this.state.redoStack.length > 0 && !this.state.groupOpen;
	}

	get undoLabel(): string | null {
		const top = this.state.undoStack.at(-1);
		if (!top) return null;
		return top.label;
	}

	get redoLabel(): string | null {
		const top = this.state.redoStack.at(-1);
		if (!top) return null;
		return top.label;
	}

	/** Undo steps, oldest first; the last one is what `undo()` reverts. For a history panel. */
	get entries(): readonly HistoryEntrySummary[] {
		return this.state.undoStack.map(summarize);
	}

	/** Undone steps, the next redo last. */
	get redoEntries(): readonly HistoryEntrySummary[] {
		return this.state.redoStack.map(summarize);
	}

	// ---------- undo and redo ----------

	/** Revert the newest step. Returns false when there is nothing to undo or a group is open. */
	undo(): boolean {
		if (!this.canUndo) return false;
		const entry = this.state.undoStack[this.state.undoStack.length - 1];
		const selectionAfter = this.selection.snapshot();
		this.replay(entry, 'undo');
		this.state.undoStack = this.state.undoStack.slice(0, -1);
		this.state.redoStack = [...this.state.redoStack, { ...entry, selectionAfter }];
		this.selection.restore(entry.selectionBefore);
		this.announce();
		return true;
	}

	/** Re-apply the most recently undone step. */
	redo(): boolean {
		if (!this.canRedo) return false;
		const entry = this.state.redoStack[this.state.redoStack.length - 1];
		this.replay(entry, 'redo');
		this.state.redoStack = this.state.redoStack.slice(0, -1);
		this.state.undoStack = [...this.state.undoStack, entry];
		if (entry.selectionAfter) this.selection.restore(entry.selectionAfter);
		this.announce();
		return true;
	}

	clear(): void {
		this.state.undoStack = [];
		this.state.redoStack = [];
		this.state.pendingSelection = null;
		this.announce();
	}

	setLimit(limit: number): void {
		if (!Number.isInteger(limit) || limit < 1) throw new RangeError('history limit must be >= 1');
		this.state.limit = limit;
		this.trim();
	}

	// ---------- grouping ----------

	/** Run `run` and make everything it commits one undo step. */
	async group<T>(options: GroupOptions, run: () => T | Promise<T>): Promise<T> {
		const handle = this.beginGroup(options);
		try {
			return await run();
		} finally {
			this.endGroup(handle);
		}
	}

	/** Open a group (a gesture, a run). A group opened inside another joins it. */
	beginGroup(options: GroupOptions): GroupHandle {
		const handle: GroupHandle = { id: generateNodeId(), closed: false };
		const open = this.state.group;
		if (open) {
			open.depth += 1;
			return handle;
		}
		this.state.group = {
			id: handle.id,
			label: options.label,
			origin: options.origin ?? 'user',
			runId: options.runId,
			depth: 1,
			selectionBefore: this.selection.snapshot(),
			transactions: []
		};
		this.state.groupOpen = true;
		this.announce();
		return handle;
	}

	endGroup(handle: GroupHandle): void {
		if (handle.closed) return;
		handle.closed = true;
		const open = this.state.group;
		if (!open) return;
		open.depth -= 1;
		if (open.depth > 0) return;
		this.state.group = null;
		this.state.groupOpen = false;
		this.finishGroup(open);
	}

	// ---------- recording (wired by the plugin) ----------

	/** `document/begin`: remember the selection as it was before the coming change. */
	captureSelection(): void {
		this.state.pendingSelection = this.selection.snapshot();
	}

	/** `document/change`: turn the committed transaction into history. */
	record(event: DocumentChangeEvent): void {
		if (event.meta.replay) return;
		const before = this.state.pendingSelection ?? this.selection.snapshot();
		this.state.pendingSelection = null;
		const transaction = event.transaction;
		const open = this.state.group;
		if (open && groupAccepts(open.runId, event.meta)) {
			this.clearRedo();
			open.transactions.push(transaction);
			return;
		}
		this.push(
			this.entryOf([transaction], transaction.label, transaction.origin, event.meta, before)
		);
	}

	/** `document/replace`: the history belongs to the old document. */
	handleDocumentReplace(): void {
		this.state.group = null;
		this.state.groupOpen = false;
		this.clear();
	}

	snapshotState(): Record<string, unknown> {
		return {
			undo: this.state.undoStack.map((entry) => entry.label),
			redo: this.state.redoStack.map((entry) => entry.label),
			group: this.state.groupOpen
		};
	}

	// ---------- internals ----------

	private replay(entry: HistoryEntry, direction: 'undo' | 'redo'): void {
		const changes = direction === 'undo' ? entry.undo : entry.changes;
		const meta: ApplyMeta = {
			origin: 'user',
			label: `${direction === 'undo' ? 'Undo' : 'Redo'} ${entry.label}`,
			replay: direction
		};
		try {
			this.document.apply(changes, meta);
		} catch (error) {
			// The document no longer matches what this entry expects; every older entry is suspect.
			this.clear();
			throw new HistoryError(`cannot ${direction} "${entry.label}"; history was cleared`, {
				cause: error
			});
		}
	}

	private finishGroup(open: OpenGroup): void {
		if (open.transactions.length === 0) {
			this.announce();
			return;
		}
		const meta: ApplyMeta = { origin: open.origin, label: open.label, runId: open.runId };
		this.push(this.entryOf(open.transactions, open.label, open.origin, meta, open.selectionBefore));
	}

	private entryOf(
		transactions: Transaction[],
		label: string,
		origin: ChangeOrigin,
		meta: ApplyMeta,
		selectionBefore: SelectionSnapshot
	): HistoryEntry {
		const changes = transactions.flatMap((transaction) => transaction.changes);
		return {
			id: generateNodeId(),
			label,
			origin,
			runId: meta.runId,
			mergeKey: meta.mergeKey,
			timestamp: this.now(),
			transactionCount: transactions.length,
			changes,
			undo: invertChanges(changes),
			selectionBefore,
			selectionAfter: null
		};
	}

	private push(entry: HistoryEntry): void {
		this.clearRedo();
		const top = this.state.undoStack.at(-1);
		if (top && this.canCoalesce(top, entry)) {
			const changes = [...top.changes, ...entry.changes];
			const merged: HistoryEntry = {
				...top,
				timestamp: entry.timestamp,
				transactionCount: top.transactionCount + entry.transactionCount,
				changes,
				undo: invertChanges(changes)
			};
			this.state.undoStack = [...this.state.undoStack.slice(0, -1), merged];
		} else {
			this.state.undoStack = [...this.state.undoStack, entry];
		}
		this.trim();
		this.announce();
	}

	private canCoalesce(top: HistoryEntry, next: HistoryEntry): boolean {
		if (next.mergeKey === undefined || top.mergeKey !== next.mergeKey) return false;
		if (top.origin !== next.origin || top.runId !== next.runId) return false;
		return next.timestamp - top.timestamp <= this.mergeWindowMs;
	}

	private trim(): void {
		const excess = this.state.undoStack.length - this.state.limit;
		if (excess > 0) this.state.undoStack = this.state.undoStack.slice(excess);
	}

	private clearRedo(): void {
		if (this.state.redoStack.length === 0) return;
		this.state.redoStack = [];
	}

	private announce(): void {
		this.ctx.emit('history/change');
	}
}

function groupAccepts(runId: string | undefined, meta: ApplyMeta): boolean {
	if (runId === undefined) return true;
	return meta.runId === runId;
}
