// The `versionHistory` service (#30): browse and restore earlier states from the file's
// transaction log (data-model.md section 6).
//
// Restoring never rewrites the log. Main answers with the changes that undo every logged
// transaction after the chosen position (newest first); they are applied to the live document as
// ONE transaction through `document.apply`, so the restore is a normal, undoable step that shows
// up in the log itself. A position whose later transactions were pruned cannot be restored; the
// list says so instead of offering it.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	RestorePlan,
	VersionHistoryData,
	VersionKind,
	VersionMark
} from '../../../electron/bridge';
import type { DocumentService } from './document';
import type { VersionHistoryState, VersionNotice } from './versionHistoryState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		versionHistory: VersionHistoryService;
	}
}

/** The part of the `desktop` service this one uses. */
export interface VersionHistoryDesktop {
	storeVersions(): Promise<VersionHistoryData>;
	storeAddVersion(name: string): Promise<VersionMark>;
	storeDeleteVersion(id: string): Promise<void>;
	storeRestorePlan(seq: number): Promise<RestorePlan>;
}

/** The part of the `fileSession` service this one uses. */
export interface VersionHistorySession {
	readonly isAttached: boolean;
	flush(): Promise<void>;
}

export const PRUNED_MESSAGE =
	'Changes before this point were pruned from the history (the log keeps the newest 1000 changes, at most 30 days), so it cannot be restored.';

export class VersionHistoryService extends Service {
	constructor(
		ctx: Context,
		private readonly desktop: VersionHistoryDesktop,
		private readonly session: VersionHistorySession,
		private readonly document: DocumentService,
		private readonly state: VersionHistoryState
	) {
		super(ctx, 'versionHistory');
	}

	// ---------- reads (reactive) ----------

	get data(): VersionHistoryData | null {
		return this.state.data;
	}
	get loading(): boolean {
		return this.state.loading;
	}
	get busy(): boolean {
		return this.state.busy;
	}
	get notice(): VersionNotice | null {
		return this.state.notice;
	}

	/** Named and automatic versions, newest first. */
	get marks(): VersionMark[] {
		const { data } = this.state;
		if (data === null) return [];
		return [...data.marks].reverse();
	}

	/** Logged changes, newest first. */
	get entries(): VersionHistoryData['entries'] {
		const { data } = this.state;
		if (data === null) return [];
		return [...data.entries].reverse();
	}

	/** The oldest changes were dropped from the log (row cap or age). */
	get hasPrunedRange(): boolean {
		const { data } = this.state;
		if (data === null) return false;
		return data.oldestSeq > 1;
	}

	/** Whether the state after the transaction at `seq` can still be restored. */
	isRestorable(seq: number): boolean {
		const { data } = this.state;
		if (data === null) return false;
		return data.oldestSeq <= seq + 1;
	}

	/** Whether `seq` is where the document stands now (nothing to restore). */
	isCurrent(seq: number): boolean {
		const { data } = this.state;
		if (data === null) return false;
		return seq === data.latestSeq;
	}

	// ---------- actions ----------

	/** Flush the autosave queue so the log is complete, then read marks and entries. */
	async refresh(): Promise<void> {
		if (!this.session.isAttached) {
			this.state.data = null;
			return;
		}
		this.state.loading = true;
		try {
			await this.session.flush();
			this.state.data = await this.desktop.storeVersions();
		} catch (error) {
			this.state.notice = {
				kind: 'error',
				text: `Could not read the history: ${messageOf(error)}`
			};
		} finally {
			this.state.loading = false;
		}
	}

	async saveVersion(name: string): Promise<VersionMark | null> {
		const trimmed = name.trim();
		if (trimmed === '') return null;
		if (!this.session.isAttached) {
			this.state.notice = { kind: 'error', text: 'No document is open.' };
			return null;
		}
		this.state.busy = true;
		try {
			await this.session.flush();
			const mark = await this.desktop.storeAddVersion(trimmed);
			this.state.notice = { kind: 'info', text: `Saved version "${mark.name}".` };
			await this.refresh();
			return mark;
		} catch (error) {
			this.state.notice = {
				kind: 'error',
				text: `Could not save the version: ${messageOf(error)}`
			};
			return null;
		} finally {
			this.state.busy = false;
		}
	}

	async deleteVersion(id: string): Promise<void> {
		try {
			await this.desktop.storeDeleteVersion(id);
			await this.refresh();
		} catch (error) {
			this.state.notice = { kind: 'error', text: `Could not delete: ${messageOf(error)}` };
		}
	}

	/**
	 * Make the live document look as it did right after the transaction at `seq`. One undoable
	 * transaction. Resolves with whether anything changed.
	 */
	async restore(seq: number, label: string): Promise<boolean> {
		if (this.state.busy) return false;
		this.state.busy = true;
		this.state.notice = null;
		try {
			// The log must hold everything the document has, or the plan would miss the newest edits.
			await this.session.flush();
			const plan = await this.desktop.storeRestorePlan(seq);
			return this.applyPlan(plan, label);
		} catch (error) {
			this.state.notice = { kind: 'error', text: `Could not restore: ${messageOf(error)}` };
			return false;
		} finally {
			this.state.busy = false;
			await this.refresh();
		}
	}

	private applyPlan(plan: RestorePlan, label: string): boolean {
		if (!plan.available) {
			this.state.notice = { kind: 'error', text: PRUNED_MESSAGE };
			return false;
		}
		if (plan.count === 0) {
			this.state.notice = { kind: 'info', text: 'The document is already at this version.' };
			return false;
		}
		this.document.apply(plan.changes, {
			origin: 'user',
			label: `Restore "${label}"`
		});
		this.state.notice = {
			kind: 'info',
			text: `Restored "${label}" (${countOf(plan.count)} undone). Undo brings it back.`
		};
		return true;
	}

	dismissNotice(): void {
		this.state.notice = null;
	}

	/** Kinds shown as automatic in the list. */
	static isAutomatic(kind: VersionKind): boolean {
		return kind !== 'named';
	}

	snapshotState(): Record<string, unknown> {
		return { loaded: this.state.data !== null, busy: this.state.busy };
	}
}

function countOf(count: number): string {
	if (count === 1) return '1 logged change';
	return `${count} logged changes`;
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
