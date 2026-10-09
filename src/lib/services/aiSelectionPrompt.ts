// The `aiSelectionPrompt` service: the AI button at the selection's top right corner on the
// canvas and the prompt card it opens (as in Figma). A request goes through `aiChat`, so it joins
// the chat conversation and the window's agent session, with the selection attached.

import { Service, type Context } from '@neoworks/extension-system';
import type { AiImage } from '../../../electron/bridge';
import type { NodeId, Rect } from '../document';
import { unionBounds } from '../editing/selectionOps';
import type { AiEvent, AiRunStatus } from '../ai/types';
import type { AiSelectionPromptState } from './aiSelectionPromptState.svelte';

const MAXIMUM_IMAGES = 8;

declare module '@neoworks/extension-system' {
	interface Context {
		aiSelectionPrompt: AiSelectionPromptService;
	}
}

/** The parts of the `aiChat` service the prompt uses. */
export interface SelectionPromptChat {
	readonly running: boolean;
	readonly needsConsent: boolean;
	/** Whether the chosen provider takes pictures. */
	readonly acceptsImages: boolean;
	askAboutSelection(prompt: string, images?: readonly AiImage[]): string | undefined;
}

/** The parts of the `ai` service the prompt uses. */
export interface SelectionPromptAi {
	readonly available: boolean;
	getRun(id: string): { status: AiRunStatus; events: readonly AiEvent[] } | undefined;
	cancel(runId: string): Promise<void>;
}

export interface SelectionPromptSelection {
	readonly ids: readonly NodeId[];
}

export interface SelectionPromptDocument {
	has(id: NodeId): boolean;
	absoluteBounds(id: NodeId): Rect;
}

export interface SelectionPromptTools {
	/** True while the pointer tool is in use, the one the selection handles belong to. */
	readonly isDefaultActive: boolean;
}

/** The model's last message: the text after its last tool call or edit, not what it said on the way. */
function finalTextOf(events: readonly AiEvent[]): string {
	let text = '';
	for (const event of events) {
		if (event.type === 'text') {
			text += event.text;
			continue;
		}
		if (event.type === 'tool_call' || event.type === 'edit') text = '';
	}
	return text.trim();
}

export class AiSelectionPromptService extends Service {
	constructor(
		ctx: Context,
		private readonly ai: SelectionPromptAi,
		private readonly chat: SelectionPromptChat,
		private readonly selection: SelectionPromptSelection,
		private readonly document: SelectionPromptDocument,
		private readonly tools: SelectionPromptTools,
		private readonly openChat: () => void,
		private readonly state: AiSelectionPromptState
	) {
		super(ctx, 'aiSelectionPrompt');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.open;
	}

	get draft(): string {
		return this.state.draft;
	}

	/** Whether the button may show at all: something is selected and the pointer tool is on. */
	get available(): boolean {
		if (!this.ai.available) return false;
		if (this.selection.ids.length === 0) return false;
		return this.tools.isDefaultActive;
	}

	/** World bounds the button sits next to: the card's anchor while open, else the selection. */
	anchorBounds(): Rect | undefined {
		let ids = this.selection.ids;
		if (this.state.open) ids = this.state.anchorIds;
		const present = ids.filter((id) => this.document.has(id));
		if (present.length === 0) return undefined;
		return unionBounds(present.map((id) => this.document.absoluteBounds(id)));
	}

	/** The card's run: running, or what the model answered. `undefined` before anything was sent. */
	runView(): { running: boolean; answer: string } | undefined {
		if (this.state.runId === null) return undefined;
		const record = this.ai.getRun(this.state.runId);
		if (record === undefined) return undefined;
		const running = record.status === 'running';
		let answer = finalTextOf(record.events);
		if (!running && answer === '') answer = this.fallbackAnswer(record.status);
		return { running, answer };
	}

	get images(): readonly AiImage[] {
		return this.state.images;
	}

	/** Whether the plus menu can attach pictures: the chosen provider takes them. */
	get acceptsImages(): boolean {
		return this.chat.acceptsImages;
	}

	/** Counts the requests to open the file picker; the card reacts to each change. */
	get imagePickRequests(): number {
		return this.state.imagePickRequests;
	}

	get canSend(): boolean {
		return this.state.draft.trim() !== '' && !this.chat.running;
	}

	// ---------- actions ----------

	open(): void {
		if (!this.available) return;
		this.state.anchorIds = [...this.selection.ids];
		this.state.draft = '';
		this.state.images = [];
		this.state.runId = null;
		this.state.open = true;
	}

	close(): void {
		this.state.open = false;
		this.state.draft = '';
		this.state.images = [];
		this.state.runId = null;
		this.state.anchorIds = [];
	}

	setDraft(text: string): void {
		this.state.draft = text;
	}

	addImage(image: AiImage): void {
		if (this.state.images.length >= MAXIMUM_IMAGES) return;
		this.state.images = [...this.state.images, image];
	}

	removeImage(index: number): void {
		this.state.images = this.state.images.filter((_, position) => position !== index);
	}

	/** Ask the open card to show its file picker for pictures. */
	requestImagePicker(): void {
		if (!this.state.open) return;
		this.state.imagePickRequests += 1;
	}

	/**
	 * Send the draft about the selection. Without consent the chat takes over: it opens with the
	 * prompt waiting in its input, and the card closes.
	 */
	send(): boolean {
		if (!this.canSend) return false;
		const runId = this.chat.askAboutSelection(this.state.draft, this.state.images);
		if (runId === undefined) {
			if (this.chat.needsConsent) {
				this.openChat();
				this.close();
			}
			return false;
		}
		this.state.runId = runId;
		this.state.draft = '';
		this.state.images = [];
		return true;
	}

	async stop(): Promise<void> {
		if (this.state.runId === null) return;
		await this.ai.cancel(this.state.runId);
	}

	/** Show the card's run in the chat and close the card. */
	showInChat(): void {
		this.openChat();
		this.close();
	}

	/** The selection changed: an idle card follows the user away and closes. */
	handleSelectionChange(): void {
		if (!this.state.open) return;
		if (this.runView()?.running === true) return;
		if (sameIds(this.state.anchorIds, this.selection.ids)) return;
		this.close();
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.open, runId: this.state.runId };
	}

	private fallbackAnswer(status: AiRunStatus): string {
		if (status === 'cancelled') return 'Stopped.';
		if (status === 'error') return 'The AI could not do that.';
		return 'Done.';
	}
}

function sameIds(left: readonly NodeId[], right: readonly NodeId[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((id) => right.includes(id));
}
