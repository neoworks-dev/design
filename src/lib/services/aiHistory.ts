// The `aiHistory` service: AI runs as undoable, attributed history (#145).
//
// Every AI write is an ordinary transaction with `origin: 'ai'` and the run id (set by ai-tools; a
// command the agent runs is stamped the same way, see `handleBegin`). This service folds them:
//
//   - one history group per run, opened by the run's first write and closed when the run ends, so
//     the whole run is ONE undo step labelled with the prompt, whatever it changed;
//   - an audit trail: for every run, what it changed (nodes, change count, the changes) read from
//     `document/change`, with its state in the undo stack (applied, undone, reverted, expired);
//   - a revert action: undo the step when it is the newest, else apply the inverse of what the
//     run did (kept as a normal user step, itself undoable);
//   - the nodes of the last run, for a highlight on the canvas.

import { Service, type Context } from '@neoworks/extension-system';
import { invertChanges, type ApplyMeta, type DocumentChangeEvent, type NodeId } from '../document';
import type { AiRunInfo, AiRunStatus } from '../ai/types';
import type { AiService } from './ai';
import type { AiHistoryState, AiRunAudit } from './aiHistoryState.svelte';
import type { DocumentService } from './document';
import type { GroupHandle, HistoryService } from './history';

declare module '@neoworks/extension-system' {
	interface Context {
		aiHistory: AiHistoryService;
	}
}

export type AiRunHistoryState = 'applied' | 'undone' | 'reverted' | 'expired';

export class AiRevertError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'AiRevertError';
	}
}

export class AiHistoryService extends Service {
	/** Open history groups by run id. */
	private readonly groups = new Map<string, GroupHandle>();

	constructor(
		ctx: Context,
		private readonly history: HistoryService,
		private readonly document: DocumentService,
		private readonly ai: AiService,
		private readonly state: AiHistoryState
	) {
		super(ctx, 'aiHistory');
	}

	// ---------- reads (reactive) ----------

	/** Every run that changed the document, oldest first. */
	audits(): readonly AiRunAudit[] {
		return this.state.audits;
	}

	auditOf(runId: string): AiRunAudit | undefined {
		return this.state.audits.find((audit) => audit.runId === runId);
	}

	/** The newest run that changed something. */
	get lastAudit(): AiRunAudit | undefined {
		return this.state.audits.at(-1);
	}

	/** Where the run's step is: still applied, undone (redo is possible), reverted or gone. */
	stateOf(runId: string): AiRunHistoryState {
		if (this.state.reverted.includes(runId)) return 'reverted';
		if (this.history.redoEntries.some((entry) => entry.runId === runId)) return 'undone';
		if (this.history.entries.some((entry) => entry.runId === runId)) return 'applied';
		return 'expired';
	}

	canRevert(runId: string): boolean {
		if (this.state.audits.every((audit) => audit.runId !== runId)) return false;
		if (this.ai.getRun(runId)?.status === 'running') return false;
		return this.stateOf(runId) === 'applied';
	}

	get highlightedIds(): readonly NodeId[] {
		if (!this.state.highlightEnabled) return [];
		return this.state.highlightIds.filter((id) => this.document.has(id));
	}

	get highlightEnabled(): boolean {
		return this.state.highlightEnabled;
	}

	// ---------- actions ----------

	setHighlightEnabled(enabled: boolean): void {
		this.state.highlightEnabled = enabled;
	}

	clearHighlight(): void {
		if (this.state.highlightIds.length === 0) return;
		this.state.highlightIds = [];
	}

	/**
	 * Take back everything one run did. The newest undo step is undone; an older run is reverted
	 * by applying the inverse of its changes as a new user step (it fails, changing nothing, when
	 * later edits no longer match).
	 */
	revertRun(runId: string): void {
		const audit = this.auditOf(runId);
		if (!audit) throw new AiRevertError(`no AI run ${runId} changed this document`);
		if (!this.canRevert(runId)) throw new AiRevertError(`"${audit.label}" is not applied any more`);
		const newest = this.history.entries.at(-1);
		if (newest && newest.runId === runId && this.history.undo()) {
			this.clearHighlight();
			return;
		}
		this.applyInverse(audit);
	}

	/** Revert the newest applied run; false when there is none. */
	revertLastRun(): boolean {
		const candidate = [...this.state.audits].reverse().find((audit) => this.canRevert(audit.runId));
		if (!candidate) return false;
		this.revertRun(candidate.runId);
		return true;
	}

	snapshotState(): Record<string, unknown> {
		return { audits: this.state.audits.length, groups: this.groups.size };
	}

	// ---------- wired by the plugin ----------

	/**
	 * `document/begin`: the first write of a run opens its history group. A change a command of
	 * the agent makes arrives as a user change; it is re-tagged to the run here (the event carries
	 * the same meta object `apply` goes on to use).
	 */
	handleBegin(meta: ApplyMeta): void {
		if (meta.replay) return;
		const run = this.runOf(meta);
		if (!run) return;
		if (meta.origin !== 'ai' || meta.runId === undefined) {
			meta.origin = 'ai';
			meta.runId = run.id;
		}
		if (this.groups.has(run.id)) return;
		this.clearHighlight();
		const handle = this.history.beginGroup({ label: run.label, origin: 'ai', runId: run.id });
		this.groups.set(run.id, handle);
	}

	/** `document/change`: record AI transactions in the audit trail; a user edit ends the highlight. */
	handleChange(event: DocumentChangeEvent): void {
		const { meta, transaction } = event;
		if (meta.replay) return;
		if (meta.origin === 'user') {
			this.clearHighlight();
			return;
		}
		if (meta.origin !== 'ai' || meta.runId === undefined) return;
		this.record(meta.runId, transaction.label, event);
	}

	/** `ai/run-end`: close the run's history group and finish its audit entry. */
	handleRunEnd(run: AiRunInfo, status: AiRunStatus): void {
		const handle = this.groups.get(run.id);
		this.groups.delete(run.id);
		if (handle) this.history.endGroup(handle);
		const audit = this.auditOf(run.id);
		if (!audit) return;
		this.updateAudit(run.id, { status, endedAt: Date.now() });
		this.state.highlightIds = audit.nodeIds;
	}

	/** Close the groups of runs that have not ended (the plugin is unloading). */
	closeOpenGroups(): void {
		for (const handle of this.groups.values()) this.history.endGroup(handle);
		this.groups.clear();
	}

	/** `document/replace`: the audit trail belongs to the old document. */
	handleDocumentReplace(): void {
		this.state.audits = [];
		this.state.reverted = [];
		this.state.highlightIds = [];
	}

	// ---------- internals ----------

	private runOf(meta: ApplyMeta): { id: string; label: string } | null {
		if (meta.origin === 'ai' && meta.runId !== undefined) {
			const known = this.ai.getRun(meta.runId);
			return { id: meta.runId, label: known === undefined ? meta.label : known.label };
		}
		const attributed = this.ai.attributedRun;
		if (meta.origin === 'user' && attributed !== null) {
			return { id: attributed.id, label: attributed.label };
		}
		return null;
	}

	private record(runId: string, label: string, event: DocumentChangeEvent): void {
		const known = this.auditOf(runId);
		const audit = known === undefined ? this.newAudit(runId, label) : known;
		const nodeIds = [...audit.nodeIds];
		for (const id of event.affectedNodeIds) if (!nodeIds.includes(id)) nodeIds.push(id);
		const next: AiRunAudit = {
			...audit,
			transactionCount: audit.transactionCount + 1,
			changeCount: audit.changeCount + event.transaction.changes.length,
			nodeIds,
			changes: [...audit.changes, ...event.transaction.changes]
		};
		if (known === undefined) this.state.audits = [...this.state.audits, next];
		else this.state.audits = this.state.audits.map((a) => (a.runId === runId ? next : a));
	}

	private newAudit(runId: string, label: string): AiRunAudit {
		const run = this.ai.getRun(runId);
		const audit: AiRunAudit = {
			runId,
			label,
			prompt: label,
			startedAt: Date.now(),
			endedAt: null,
			status: 'running',
			transactionCount: 0,
			changeCount: 0,
			nodeIds: [],
			changes: []
		};
		if (run === undefined) return audit;
		return { ...audit, label: run.label, prompt: run.prompt, startedAt: run.startedAt };
	}

	private updateAudit(runId: string, patch: Partial<AiRunAudit>): void {
		this.state.audits = this.state.audits.map((audit) =>
			audit.runId === runId ? { ...audit, ...patch } : audit
		);
	}

	private applyInverse(audit: AiRunAudit): void {
		try {
			this.document.apply(invertChanges(audit.changes), {
				origin: 'user',
				label: `Revert "${audit.label}"`
			});
		} catch (error) {
			throw new AiRevertError(
				`cannot revert "${audit.label}": the document changed since, nothing was reverted`,
				{ cause: error }
			);
		}
		this.state.reverted = [...this.state.reverted, audit.runId];
		this.clearHighlight();
	}
}
