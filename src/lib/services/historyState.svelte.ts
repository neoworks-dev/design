// Reactive holder behind the `history` service (a Service may not hold runes).

import type { ChangeOrigin, Change, Transaction } from '../document';
import type { SelectionSnapshot } from './selection';

/** One undo step: a transaction, or the merge of several (a coalesced nudge, a plugin run). */
export interface HistoryEntry {
	id: string;
	label: string;
	origin: ChangeOrigin;
	runId?: string;
	mergeKey?: string;
	/** When the last transaction folded into this entry committed (ms, `now()` of the service). */
	timestamp: number;
	transactionCount: number;
	changes: Change[];
	undo: Change[];
	selectionBefore: SelectionSnapshot;
	/** Filled in when the entry is undone, so redo can restore the selection of that moment. */
	selectionAfter: SelectionSnapshot | null;
}

/** What a history panel needs to list; no change data. */
export interface HistoryEntrySummary {
	id: string;
	label: string;
	origin: ChangeOrigin;
	runId?: string;
	timestamp: number;
	transactionCount: number;
}

/** A group opened by `beginGroup`; transactions that match it fold into one entry. */
export interface OpenGroup {
	id: string;
	label: string;
	origin: ChangeOrigin;
	runId?: string;
	depth: number;
	selectionBefore: SelectionSnapshot;
	transactions: Transaction[];
}

const DEFAULT_LIMIT = 100;

export class HistoryState {
	undoStack = $state.raw<readonly HistoryEntry[]>([]);
	redoStack = $state.raw<readonly HistoryEntry[]>([]);

	/** Reactive mirror of `group !== null`, so `canUndo` re-evaluates when a group opens. */
	groupOpen = $state.raw(false);
	limit = DEFAULT_LIMIT;

	/** Not reactive: bookkeeping between `document/begin` and `document/change`. */
	pendingSelection: SelectionSnapshot | null = null;
	group: OpenGroup | null = null;
}
