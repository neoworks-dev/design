// The `aiRename` service (#149): rename the default-named layers of the selection with the AI.
//
// The run asks the model for names; the model answers by calling the `rename_layers` tool, and
// this service is what the tool runs. The tool is the guard: it only renames layers the run was
// started for, and only while they still carry their default name, so a model that returns more
// than it was asked for changes nothing else. All names of a run are one transaction (one undo
// step, attributed to the run).

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import {
	collectRenameCandidates,
	hasDefaultName,
	MAX_LAYER_NAME_LENGTH,
	renamePrompt,
	type RenameCandidate
} from '../ai/rename';
import { AiConsentRequiredError, type AiEditSummary, type AiRunInfo } from '../ai/types';
import type { Change } from '../document';
import type { AiRenameState } from './aiRenameState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		aiRename: AiRenameService;
	}
}

/** The parts of the `ai` service the rename uses. */
export interface RenameAi {
	readonly available: boolean;
	run(
		prompt: string,
		options?: { scope?: 'write' | 'read'; display?: string }
	): { id: string; finished: Promise<unknown> };
	reportEdit(runId: string, edit: AiEditSummary): void;
}

export interface RenameDocument {
	readonly currentPageId: NodeId;
	get(id: NodeId): Node | undefined;
	children(id: NodeId | null): readonly NodeId[];
	setProps(id: NodeId, props: Record<string, unknown>): Change[];
	transaction<T>(meta: { origin: 'ai'; label: string; runId: string }, run: () => T): T;
	apply(
		changes: Change[],
		meta: { origin: 'ai'; label: string; runId: string }
	): { changes: readonly Change[] };
}

export interface RenameEntry {
	id: string;
	name: string;
}

export interface RenameOutcome {
	renamed: { id: NodeId; from: string; to: string }[];
	skipped: { id: string; reason: string }[];
}

export class AiRenameService extends Service {
	private readonly allowed = new Map<string, Set<NodeId>>();
	/** What each run's tool calls renamed; read when the run finishes. */
	private readonly outcomes = new Map<string, RenameOutcome>();

	constructor(
		ctx: Context,
		private readonly ai: RenameAi,
		private readonly document: RenameDocument,
		private readonly selection: { readonly ids: readonly NodeId[] },
		private readonly state: AiRenameState,
		private readonly openChat: () => void,
		private readonly suggestionsEnabled: boolean
	) {
		super(ctx, 'aiRename');
	}

	// ---------- reads (reactive) ----------

	/** Default-named layers in the selection (the page when nothing is selected). */
	candidates(): RenameCandidate[] {
		let roots: readonly NodeId[] = this.selection.ids;
		if (roots.length === 0) roots = this.document.children(this.document.currentPageId);
		return collectRenameCandidates(this.document, roots);
	}

	get running(): boolean {
		return this.state.running;
	}

	get notice(): string {
		return this.state.notice;
	}

	/**
	 * The hint "Missing N layer names" while a container with default-named layers is selected.
	 * `undefined` when there is nothing to offer, it was dismissed for this selection or a run is
	 * going.
	 */
	get suggestion(): { count: number } | undefined {
		if (!this.suggestionsEnabled || this.state.running || !this.ai.available) return undefined;
		const ids = this.selection.ids;
		if (ids.length === 0) return undefined;
		if (this.state.dismissedFor === ids.join(',')) return undefined;
		if (!ids.some((id) => this.document.children(id).length > 0)) return undefined;
		const count = collectRenameCandidates(this.document, ids).length;
		if (count === 0) return undefined;
		return { count };
	}

	// ---------- actions ----------

	dismiss(): void {
		this.state.dismissedFor = this.selection.ids.join(',');
		this.state.notice = '';
	}

	/**
	 * Ask the AI to name the default-named layers of the selection. Resolves with what was
	 * renamed; `undefined` when there is nothing to rename or the document needs consent first.
	 */
	async renameLayers(): Promise<RenameOutcome | undefined> {
		if (this.state.running) return undefined;
		const candidates = this.candidates();
		if (candidates.length === 0) {
			this.state.notice = 'Every layer here already has a name.';
			return undefined;
		}
		let run: { id: string; finished: Promise<unknown> };
		try {
			run = this.ai.run(renamePrompt(candidates), {
				scope: 'write',
				display: 'Rename layers'
			});
		} catch (error) {
			if (!(error instanceof AiConsentRequiredError)) throw error;
			this.state.notice = 'Allow the AI for this document in the AI panel, then try again.';
			this.openChat();
			return undefined;
		}
		this.allowed.set(run.id, new Set(candidates.map((candidate) => candidate.id)));
		this.state.running = true;
		this.state.notice = '';
		try {
			await run.finished;
		} finally {
			this.state.running = false;
			this.allowed.delete(run.id);
		}
		const outcome = this.outcomes.get(run.id);
		this.outcomes.delete(run.id);
		if (outcome === undefined) {
			this.state.notice = 'The AI did not rename any layer.';
			return undefined;
		}
		const count = outcome.renamed.length;
		let noun = 'layers';
		if (count === 1) noun = 'layer';
		this.state.notice = `Renamed ${count} ${noun}.`;
		return outcome;
	}

	/** The `rename_layers` tool: apply the names the run is allowed to apply. */
	applyNames(run: AiRunInfo, entries: readonly RenameEntry[]): RenameOutcome {
		const permitted = this.allowed.get(run.id);
		const outcome: RenameOutcome = { renamed: [], skipped: [] };
		const changes: { id: NodeId; name: string }[] = [];
		for (const entry of entries) {
			const reason = this.refusal(permitted, entry, changes);
			if (reason !== undefined) {
				outcome.skipped.push({ id: entry.id, reason });
				continue;
			}
			changes.push({ id: entry.id, name: entry.name.trim() });
		}
		if (changes.length > 0) this.commit(run, changes, outcome);
		const previous = this.outcomes.get(run.id);
		this.outcomes.set(run.id, mergeOutcomes(previous, outcome));
		return outcome;
	}

	snapshotState(): Record<string, unknown> {
		return { running: this.state.running, runs: this.allowed.size };
	}

	// ---------- internals ----------

	private refusal(
		permitted: Set<NodeId> | undefined,
		entry: RenameEntry,
		accepted: readonly { id: NodeId }[]
	): string | undefined {
		if (permitted === undefined) return 'this run was not started to rename layers';
		if (!permitted.has(entry.id)) return 'not one of the layers to rename';
		const node = this.document.get(entry.id);
		if (node === undefined) return 'layer no longer exists';
		if (!hasDefaultName(node)) return 'the layer was named in the meantime';
		const name = entry.name.trim();
		if (name === '') return 'empty name';
		if (name.length > MAX_LAYER_NAME_LENGTH) return `name longer than ${MAX_LAYER_NAME_LENGTH}`;
		if (accepted.some((known) => known.id === entry.id)) return 'named twice';
		return undefined;
	}

	private commit(
		run: AiRunInfo,
		changes: readonly { id: NodeId; name: string }[],
		outcome: RenameOutcome
	): void {
		const meta = { origin: 'ai' as const, label: run.label, runId: run.id };
		let changeCount = 0;
		this.document.transaction(meta, () => {
			for (const change of changes) {
				const before = this.document.get(change.id)?.name ?? '';
				const applied = this.document.apply(
					this.document.setProps(change.id, { name: change.name }),
					meta
				);
				changeCount += applied.changes.length;
				outcome.renamed.push({ id: change.id, from: before, to: change.name });
			}
		});
		this.ai.reportEdit(run.id, {
			label: 'Rename layers',
			nodeIds: changes.map((change) => change.id),
			changeCount
		});
	}
}

function mergeOutcomes(previous: RenameOutcome | undefined, next: RenameOutcome): RenameOutcome {
	if (previous === undefined) return next;
	return {
		renamed: [...previous.renamed, ...next.renamed],
		skipped: [...previous.skipped, ...next.skipped]
	};
}
