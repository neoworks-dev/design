// The `aiChat` service: what the AI chat panel does, without the markup (#146). It sends, stops and
// retries runs through the `ai` service, holds the draft, the selection attachment and the open
// rows, and lists the runs of the open document as the conversation ("history per document": the
// run registry keeps every run with its document id).

import { Service, type Context } from '@neoworks/extension-system';
import type { AiProviderInfo } from '../../../electron/bridge';
import { AiConsentRequiredError, type AiAttachment, type AiRunRecord } from '../ai/types';
import { Registry, type RegistryEntry } from '../registries/registry.svelte';
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

/** The parts of the document the chat uses. */
export interface AiChatDocument {
	readonly documentId: string;
}

/** What `aiContext` offers the chat: the selection as a prompt attachment. */
export interface AiChatContext {
	selectionAttachment(): AiAttachment | undefined;
}

/** A `/name text` action of the chat input, contributed by a plugin (for example `/generate`). */
export interface ChatSlashAction extends RegistryEntry {
	/** The word after the slash; also the registry id. */
	id: string;
	title: string;
	run(argument: string): void | Promise<void>;
}

export class AiChatService extends Service {
	/** Actions the input accepts as `/id argument` instead of sending a prompt. */
	readonly slashActions = new Registry<ChatSlashAction>();

	constructor(
		ctx: Context,
		private readonly ai: AiChatAi,
		private readonly aiHistory: AiChatHistory,
		private readonly document: AiChatDocument,
		private readonly context: AiChatContext,
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

	registerSlashAction(action: ChatSlashAction): () => void {
		return this.slashActions.register(action);
	}

	/** The titles shown as a hint under the input, e.g. `/generate`. */
	slashHints(): string[] {
		return this.slashActions.list().map((action) => `/${action.id}`);
	}

	/** Send the draft. Without consent for this document nothing is sent and the panel asks. */
	send(): boolean {
		if (!this.canSend) return false;
		const prompt = this.state.draft.trim();
		if (this.runSlashAction(prompt)) {
			this.state.draft = '';
			return true;
		}
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

	private runSlashAction(prompt: string): boolean {
		const match = /^\/(\w[\w-]*)\s*(.*)$/s.exec(prompt);
		if (match === null) return false;
		const action = this.slashActions.get(match[1]);
		if (action === undefined) return false;
		void Promise.resolve(action.run(match[2].trim()));
		return true;
	}

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
		if (!this.state.attachSelection) return [];
		const attachment = this.context.selectionAttachment();
		if (attachment === undefined) return [];
		return [attachment];
	}
}
