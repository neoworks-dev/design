// The `aiChat` service: what the AI chat panel does, without the markup (#146). It sends, stops and
// retries runs through the `ai` service, holds the draft, the selection attachment and the open
// rows, and lists the runs of the open document as the conversation ("history per document": the
// run registry keeps every run with its document id).

import { Service, type Context } from '@neoworks/extension-system';
import type { AiImage, AiProviderInfo } from '../../../electron/bridge';
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
	readonly effortId: string;
	runs(): readonly AiRunRecord[];
	hasConsent(documentId: string): boolean;
	grantConsent(documentId: string): void;
	run(
		prompt: string,
		options?: { attachments?: AiAttachment[]; images?: AiImage[] }
	): { id: string };
	cancel(runId: string): Promise<void>;
	selectModel(providerId: string, modelId: string): void;
	selectEffort(effort: string): void;
	refreshProviders(): Promise<readonly AiProviderInfo[]>;
}

/** Sent as the prompt when the user pasted images and typed nothing. */
const IMAGE_ONLY_PROMPT = 'Look at the attached image.';
/** As many as `ai:send` accepts. */
const MAXIMUM_IMAGES = 8;

const EFFORT_LABELS: Record<string, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra high',
	max: 'Max',
	ultracode: 'Ultracode'
};

function effortLabel(effort: string): string {
	const label = EFFORT_LABELS[effort];
	if (label === undefined) return effort;
	return label;
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
		if (this.running || !this.ai.available) return false;
		return this.state.draft.trim() !== '' || this.state.images.length > 0;
	}

	/** Pictures pasted into the input, sent with the next prompt. */
	get images(): readonly AiImage[] {
		return this.state.images;
	}

	/** Whether the chosen provider takes images; unknown providers are assumed to. */
	get acceptsImages(): boolean {
		const provider = this.currentProvider();
		if (provider === undefined) return true;
		return provider.images;
	}

	/** The runs of the open document, oldest first. */
	conversation(): readonly AiRunRecord[] {
		const documentId = this.document.documentId;
		return this.ai.runs().filter((record) => record.documentId === documentId);
	}

	/** Harnesses that are installed and logged in. */
	providerOptions(): { value: string; label: string }[] {
		return this.ai.providers
			.filter((provider) => provider.available)
			.map((provider) => ({ value: provider.id, label: provider.label }));
	}

	get providerId(): string {
		return this.ai.providerId;
	}

	/** Models offered by the chosen provider. */
	modelOptions(): { value: string; label: string; description?: string }[] {
		const provider = this.currentProvider();
		if (provider === undefined) return [];
		return provider.models.map((model) => ({
			value: model.id,
			label: model.name,
			description: model.description
		}));
	}

	/** Reasoning efforts the chosen provider offers, lowest first. */
	effortOptions(): { value: string; label: string }[] {
		const provider = this.currentProvider();
		if (provider === undefined) return [];
		return provider.efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }));
	}

	get effortId(): string {
		return this.ai.effortId;
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
		const images = this.imagesToSend();
		let text = prompt;
		if (text === '') text = IMAGE_ONLY_PROMPT;
		if (this.start(text, this.attachments(), images) === undefined) return false;
		this.state.draft = '';
		this.state.images = [];
		return true;
	}

	/**
	 * Send `prompt` about the current selection, from outside the panel (the canvas AI button).
	 * It joins this conversation and the window's agent session like a typed message. Without
	 * consent the prompt waits in the input with the selection attached, and `undefined` returns.
	 */
	askAboutSelection(prompt: string, images: readonly AiImage[] = []): string | undefined {
		const text = prompt.trim();
		if (text === '' || this.running || !this.ai.available) return undefined;
		const selection = this.context.selectionAttachment();
		const attachments: AiAttachment[] = [];
		if (selection !== undefined) attachments.push(selection);
		const runId = this.start(text, attachments, [...images]);
		if (runId !== undefined) return runId;
		this.state.draft = text;
		images.forEach((image) => this.addImage(image));
		this.state.attachSelection = true;
		return undefined;
	}

	addImage(image: AiImage): void {
		if (this.state.images.length >= MAXIMUM_IMAGES) return;
		this.state.images = [...this.state.images, image];
	}

	removeImage(index: number): void {
		this.state.images = this.state.images.filter((_, position) => position !== index);
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
		return this.start(record.prompt, [], [...record.images]) !== undefined;
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

	setEffort(effort: string): void {
		this.ai.selectEffort(effort);
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

	/** The id of the run started, or `undefined` when it waits for consent. */
	private start(
		prompt: string,
		attachments: AiAttachment[],
		images: AiImage[]
	): string | undefined {
		try {
			return this.ai.run(prompt, { attachments, images }).id;
		} catch (error) {
			if (error instanceof AiConsentRequiredError) {
				this.state.awaitingConsent = true;
				return undefined;
			}
			throw error;
		}
	}

	private currentProvider(): AiProviderInfo | undefined {
		return this.ai.providers.find((candidate) => candidate.id === this.ai.providerId);
	}

	private imagesToSend(): AiImage[] {
		if (!this.acceptsImages) return [];
		return [...this.state.images];
	}

	private attachments(): AiAttachment[] {
		if (!this.state.attachSelection) return [];
		const attachment = this.context.selectionAttachment();
		if (attachment === undefined) return [];
		return [attachment];
	}
}
