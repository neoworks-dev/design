// The `aiChat` service: what the AI chat panel does, without the markup (#146). It sends, stops and
// retries runs through the `ai` service, holds the draft, the selection attachment and the open
// rows, and lists the runs of the open document as the conversation ("history per document": the
// run registry keeps every run with its document id).

import { Service, type Context } from '@neoworks/extension-system';
import type { AiProviderInfo } from '../../../electron/bridge';
import { AiConsentRequiredError, type AiAttachment, type AiRunRecord } from '../ai/types';
import type { AiRunHistoryState } from './aiHistory';
import type { AiChatState } from './aiChatState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		aiChat: AiChatService;
	}
}

/** The parts of the `ai` service the chat uses. */
export interface AiChatAi {
	readonly available: boolean;
	readonly activeRun: AiRunRecord | undefined;
	readonly providers: readonly AiProviderInfo[];
	readonly providerId: string;
	readonly modelId: string;
	runs(): readonly AiRunRecord[];
	hasConsent(documentId: string): boolean;
	grantConsent(documentId: string): void;
	run(prompt: string, options?: { attachments?: AiAttachment[] }): { id: string };
	cancel(runId: string): Promise<void>;
	selectModel(providerId: string, modelId: string): void;
	refreshProviders(): Promise<readonly AiProviderInfo[]>;
}

/** The parts of the `aiHistory` service the chat uses. */
export interface AiChatHistory {
	stateOf(runId: string): AiRunHistoryState;
	canRevert(runId: string): boolean;
	revertRun(runId: string): void;
	revertLastRun(): boolean;
}

/** The parts of the document and selection the chat uses. */
export interface AiChatDocument {
	readonly documentId: string;
	get(id: string): { id: string; name: string; type: string } | undefined;
}
export interface AiChatSelection {
	readonly ids: readonly string[];
}

const MAX_ATTACHED_LAYERS = 20;

export class AiChatService extends Service {
	constructor(
		ctx: Context,
		private readonly ai: AiChatAi,
		private readonly aiHistory: AiChatHistory,
		private readonly document: AiChatDocument,
		private readonly selection: AiChatSelection,
		private readonly state: AiChatState
	) {
		super(ctx, 'aiChat');
	}

	// ---------- reads (reactive) ----------

	get draft(): string {
		return this.state.draft;
	}

	get attachSelection(): boolean {
		return this.state.attachSelection;
	}

	get awaitingConsent(): boolean {
		return this.state.awaitingConsent;
	}

	get needsConsent(): boolean {
		return !this.ai.hasConsent(this.document.documentId);
	}

	get running(): boolean {
		return this.ai.activeRun !== undefined;
	}

	get canSend(): boolean {
		return this.state.draft.trim() !== '' && !this.running && this.ai.available;
	}

	/** The runs of the open document, oldest first. */
	conversation(): readonly AiRunRecord[] {
		const documentId = this.document.documentId;
		return this.ai.runs().filter((record) => record.documentId === documentId);
	}

	/** Models offered by the chosen provider. */
	modelOptions(): { value: string; label: string }[] {
		const provider = this.ai.providers.find((candidate) => candidate.id === this.ai.providerId);
		if (provider === undefined) return [];
		return provider.models.map((model) => ({ value: model.id, label: model.name }));
	}

	get modelId(): string {
		return this.ai.modelId;
	}

	get modelLabel(): string {
		const option = this.modelOptions().find((candidate) => candidate.value === this.ai.modelId);
		if (option !== undefined) return option.label;
		const provider = this.ai.providers.find((candidate) => candidate.id === this.ai.providerId);
		if (provider !== undefined) return provider.label;
		return '';
	}

	isExpanded(key: string): boolean {
		return this.state.expanded.includes(key);
	}

	/** The last run that changed the document and can still be taken back. */
	get revertibleRunId(): string | null {
		const runs = this.conversation();
		for (let position = runs.length - 1; position >= 0; position -= 1) {
			if (this.aiHistory.canRevert(runs[position].id)) return runs[position].id;
		}
		return null;
	}

	historyStateOf(runId: string): AiRunHistoryState {
		return this.aiHistory.stateOf(runId);
	}

	// ---------- actions ----------

	setDraft(text: string): void {
		this.state.draft = text;
	}

	setAttachSelection(attach: boolean): void {
		this.state.attachSelection = attach;
	}

	toggleRow(key: string): void {
		if (this.state.expanded.includes(key)) {
			this.state.expanded = this.state.expanded.filter((open) => open !== key);
			return;
		}
		this.state.expanded = [...this.state.expanded, key];
	}

	/** Send the draft. Without consent for this document nothing is sent and the panel asks. */
	send(): boolean {
		if (!this.canSend) return false;
		const prompt = this.state.draft.trim();
		if (!this.start(prompt, this.attachments())) return false;
		this.state.draft = '';
		return true;
	}

	/** Allow this document to go to a model, then send what was held back. */
	allowAndSend(): void {
		this.ai.grantConsent(this.document.documentId);
		this.state.awaitingConsent = false;
		this.send();
	}

	stop(): Promise<void> {
		const active = this.ai.activeRun;
		if (active === undefined) return Promise.resolve();
		return this.ai.cancel(active.id);
	}

	/** Run the prompt of an earlier run again (after an error or a cancel). */
	retry(runId: string): boolean {
		if (this.running) return false;
		const record = this.ai.runs().find((candidate) => candidate.id === runId);
		if (record === undefined) return false;
		return this.start(record.prompt, []);
	}

	/** Take back one run's changes (the undo link under it). */
	undoRun(runId: string): void {
		this.aiHistory.revertRun(runId);
	}

	setModel(modelId: string): void {
		this.ai.selectModel(this.ai.providerId, modelId);
	}

	setProvider(providerId: string): void {
		this.ai.selectModel(providerId, '');
	}

	async loadProviders(): Promise<void> {
		await this.ai.refreshProviders().catch(() => undefined);
	}

	// ---------- internals ----------

	private start(prompt: string, attachments: AiAttachment[]): boolean {
		try {
			this.ai.run(prompt, { attachments });
		} catch (error) {
			if (error instanceof AiConsentRequiredError) {
				this.state.awaitingConsent = true;
				return false;
			}
			throw error;
		}
		return true;
	}

	private attachments(): AiAttachment[] {
		if (!this.state.attachSelection || this.selection.ids.length === 0) return [];
		const lines: string[] = [];
		for (const id of this.selection.ids.slice(0, MAX_ATTACHED_LAYERS)) {
			const node = this.document.get(id);
			if (node !== undefined) lines.push(`${node.type} ${node.id} "${node.name}"`);
		}
		const extra = this.selection.ids.length - MAX_ATTACHED_LAYERS;
		if (extra > 0) lines.push(`and ${extra} more`);
		return [
			{
				kind: 'selection',
				label: `Selection (${this.selection.ids.length})`,
				text: lines.join('\n')
			}
		];
	}
}
