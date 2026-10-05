// Reactive holder behind the `aiHistory` service (a Service may not hold runes).

import type { Change, NodeId } from '../document';
import type { AiRunStatus } from '../ai/types';

/** What one AI run did to the document, read from the transactions it committed. */
export interface AiRunAudit {
	runId: string;
	/** The prompt, shortened: also the label of the run's undo step. */
	label: string;
	prompt: string;
	startedAt: number;
	endedAt: number | null;
	/** `running` until the run ends. */
	status: AiRunStatus;
	transactionCount: number;
	changeCount: number;
	/** Every node the run created, changed or deleted, in first-touched order. */
	nodeIds: NodeId[];
	/** Everything the run applied, oldest first (what a revert inverts). */
	changes: Change[];
}

export class AiHistoryState {
	audits = $state.raw<readonly AiRunAudit[]>([]);
	/** Runs undone by applying their inverse (not by the undo stack). */
	reverted = $state.raw<readonly string[]>([]);
	/** Nodes of the last finished run to draw a highlight around. */
	highlightIds = $state.raw<readonly NodeId[]>([]);
	highlightEnabled = $state.raw(true);
}
