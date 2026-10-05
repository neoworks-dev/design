// The `aiReview` service (#151): optional review of AI edits. Edits are still applied as one run
// (one undo step, see aiHistory) so the user sees the result at once; in review mode a finished
// run that changed the document waits for a decision, its layers outlined on the canvas. Accept
// keeps it, reject takes it back exactly (the history step is undone, or its inverse applied).

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import type { AiRunInfo, AiRunStatus } from '../ai/types';
import type { AiRunAudit } from './aiHistoryState.svelte';
import type { AiReviewState } from './aiReviewState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		aiReview: AiReviewService;
	}
}

/** The parts of `aiHistory` the review uses. */
export interface ReviewHistory {
	auditOf(runId: string): AiRunAudit | undefined;
	canRevert(runId: string): boolean;
	revertRun(runId: string): void;
}

export interface ReviewDocument {
	has(id: NodeId): boolean;
}

export class AiReviewService extends Service {
	constructor(
		ctx: Context,
		private readonly history: ReviewHistory,
		private readonly document: ReviewDocument,
		private readonly state: AiReviewState
	) {
		super(ctx, 'aiReview');
	}

	get enabled(): boolean {
		return this.state.enabled;
	}

	/** Runs still waiting; one that can no longer be reverted (edited over, undone) is dropped. */
	pending(): readonly AiRunAudit[] {
		const audits: AiRunAudit[] = [];
		for (const runId of this.state.waiting) {
			const audit = this.history.auditOf(runId);
			if (audit !== undefined && this.history.canRevert(runId)) audits.push(audit);
		}
		return audits;
	}

	/** Layers of the waiting runs that still exist. */
	pendingNodeIds(): NodeId[] {
		const ids = new Set<NodeId>();
		for (const audit of this.pending()) {
			for (const id of audit.nodeIds) if (this.document.has(id)) ids.add(id);
		}
		return [...ids];
	}

	setEnabled(enabled: boolean): void {
		this.state.enabled = enabled;
	}

	/** Keep the run's changes. */
	accept(runId: string): void {
		this.forget(runId);
	}

	/** Take the run's changes back. Throws when later edits no longer allow it. */
	reject(runId: string): void {
		this.history.revertRun(runId);
		this.forget(runId);
	}

	acceptAll(): void {
		this.state.waiting = [];
	}

	rejectAll(): void {
		for (const audit of [...this.pending()].reverse()) this.reject(audit.runId);
		this.state.waiting = [];
	}

	/** `ai/run-end` (after aiHistory closed the run's step): queue the run when review is on. */
	handleRunEnd(run: AiRunInfo, status: AiRunStatus): void {
		if (!this.state.enabled || status === 'error') return;
		if (this.history.auditOf(run.id) === undefined) return;
		this.state.waiting = [...this.state.waiting, run.id];
	}

	handleDocumentReplace(): void {
		this.state.waiting = [];
	}

	snapshotState(): Record<string, unknown> {
		return { waiting: this.state.waiting.length };
	}

	private forget(runId: string): void {
		this.state.waiting = this.state.waiting.filter((id) => id !== runId);
	}
}
