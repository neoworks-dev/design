// Types of the renderer's `ai` service: runs, the events a run yields and the tool handlers that
// plugins register for the agent to call. The wire types (what crosses IPC) are in
// electron/bridge.ts; a run's events add `edit`, which the renderer itself reports when a write
// tool changed the document.

import type { AiImage, AiToolStatus } from '../../../electron/bridge';
import type { RegistryEntry } from '../registries/registry.svelte';

export type AiRunStatus = 'running' | 'done' | 'cancelled' | 'error';

/** Read-only runs may only call tools that do not write. */
export type AiScope = 'read' | 'write';

export interface AiEditSummary {
	label: string;
	/** Nodes the call created, changed or removed. */
	nodeIds: string[];
	changeCount: number;
}

export type AiEvent =
	| { type: 'text'; text: string }
	| { type: 'thought'; text: string }
	| { type: 'tool_call'; callId: string; name: string; input?: unknown; status: AiToolStatus }
	| { type: 'edit'; edit: AiEditSummary }
	| { type: 'done'; stopReason: string }
	| { type: 'error'; message: string };

/** What a prompt carries besides its words: the selection, a screenshot description, a note. */
export interface AiAttachment {
	kind: 'selection' | 'text';
	label: string;
	/** Rendered into the prompt for the model. */
	text: string;
}

export interface AiRunOptions {
	/** What the chat shows (and the undo step is labelled with) instead of the raw prompt. */
	display?: string;
	/** Defaults to `write`. */
	scope?: AiScope;
	/** Only these tools are offered to (and accepted from) the run; all by default. */
	tools?: readonly string[];
	attachments?: AiAttachment[];
	/** Pictures sent with the prompt; providers without image input never get them. */
	images?: AiImage[];
	provider?: string;
	model?: string;
	effort?: string;
}

/** The run registry's view of one run; `origin` is what the document tags its edits with. */
export interface AiRunInfo {
	id: string;
	/** Label of the history entry and audit trail: the prompt, shortened. */
	label: string;
	prompt: string;
	/** The prompt as the user should read it, when it differs from the text sent to the model. */
	display?: string;
	/** The tools the run may use, when it is limited to some. */
	tools?: readonly string[];
	origin: 'ai';
	scope: AiScope;
	provider: string;
	model: string | null;
	/** The reasoning effort, `null` for the harness default. */
	effort: string | null;
	images: readonly AiImage[];
	documentId: string;
	startedAt: number;
}

/** A run as the chat shows it: info, status and what streamed so far. */
/** A tool call the renderer answered: what the agent sent and what it got back. */
export interface AiToolOutcome {
	tool: string;
	input: unknown;
	ok: boolean;
	/** The answer the model saw, shortened for long reads. */
	text: string;
}

export interface AiRunRecord extends AiRunInfo {
	status: AiRunStatus;
	events: AiEvent[];
	/** Answered tool calls in order, for the chat's tool cards. */
	toolResults: AiToolOutcome[];
	endedAt: number | null;
	error: string | null;
}

/** A document tool the agent can call; plugins register these with `ai.registerTool`. */
export interface AiToolHandler extends RegistryEntry {
	/** The tool name the model sees (also the registry id). */
	id: string;
	description: string;
	write: boolean;
	/** JSON Schema of the arguments. */
	inputSchema: Record<string, unknown>;
	/**
	 * Offered only to runs that name it in `tools` (a task's answer channel, like
	 * `rename_layers`); runs without a tool list get the general tools only.
	 */
	taskOnly?: boolean;
	/** Returns the text the model sees; throws a readable message to fail the call. */
	run(input: unknown, run: AiRunInfo): string | Promise<string>;
}

/**
 * Guidance the agent loads on demand with the `skill` tool, instead of carrying every detail in
 * the system prompt and tool descriptions. Plugins register the skills of their features.
 */
export interface AiSkill extends RegistryEntry {
	/** What the agent passes to `skill`, e.g. `layout`. */
	id: string;
	/** One line for the index in the system prompt: when to load it. */
	summary: string;
	/** The guidance, as markdown; a function when it reads live state (commands, components). */
	body: string | (() => string);
	/**
	 * A tool name: when the session offers that tool, the body goes straight into the system prompt
	 * instead of the index (for guidance the agent needs on every use of the tool).
	 */
	inlineWith?: string;
}

export class AiConsentRequiredError extends Error {
	constructor(readonly documentId: string) {
		super('sending this document to a model needs your consent first');
		this.name = 'AiConsentRequiredError';
	}
}

export class AiUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiUnavailableError';
	}
}

const LABEL_LENGTH = 60;

/** The first line of the prompt, shortened: the label of the run's history entry. */
export function summarizePrompt(prompt: string): string {
	const firstLine = prompt.trim().split('\n')[0].trim();
	if (firstLine.length <= LABEL_LENGTH) return firstLine;
	return `${firstLine.slice(0, LABEL_LENGTH - 1).trimEnd()}…`;
}

/**
 * Add `event` to a run's recorded events: consecutive text (or thought) chunks merge into one,
 * and a tool call event updates the entry with the same call id instead of adding another.
 */
export function appendAiEvent(events: readonly AiEvent[], event: AiEvent): AiEvent[] {
	const last = events.at(-1);
	if ((event.type === 'text' || event.type === 'thought') && last && last.type === event.type) {
		return [...events.slice(0, -1), { type: event.type, text: last.text + event.text }];
	}
	if (event.type === 'tool_call') {
		const position = events.findIndex(
			(known) => known.type === 'tool_call' && known.callId === event.callId
		);
		if (position >= 0) {
			const known = events[position];
			if (known.type !== 'tool_call') return [...events];
			const merged: AiEvent = {
				...known,
				status: event.status,
				name: event.name === '' ? known.name : event.name,
				input: event.input === undefined ? known.input : event.input
			};
			return events.map((existing, index) => (index === position ? merged : existing));
		}
	}
	return [...events, event];
}

/** Minimal async queue: one producer pushes, one consumer iterates until `end`. */
export class AiEventQueue implements AsyncIterable<AiEvent> {
	private readonly buffered: AiEvent[] = [];
	private waiting: ((result: IteratorResult<AiEvent>) => void) | null = null;
	private ended = false;

	push(event: AiEvent): void {
		if (this.ended) return;
		if (this.waiting) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve({ value: event, done: false });
			return;
		}
		this.buffered.push(event);
	}

	end(): void {
		this.ended = true;
		if (!this.waiting) return;
		const resolve = this.waiting;
		this.waiting = null;
		resolve({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<AiEvent> {
		return {
			next: () => {
				const next = this.buffered.shift();
				if (next !== undefined) return Promise.resolve({ value: next, done: false });
				if (this.ended) return Promise.resolve({ value: undefined, done: true });
				return new Promise((resolve) => {
					this.waiting = resolve;
				});
			}
		};
	}
}

/** What `ai.run` returns: iterate for events, await `finished`, or `cancel()`. */
export class AiRun implements AsyncIterable<AiEvent> {
	constructor(
		readonly info: AiRunInfo,
		private readonly queue: AiEventQueue,
		readonly finished: Promise<AiRunStatus>,
		private readonly cancelRun: () => Promise<void>
	) {}

	get id(): string {
		return this.info.id;
	}

	cancel(): Promise<void> {
		return this.cancelRun();
	}

	[Symbol.asyncIterator](): AsyncIterator<AiEvent> {
		return this.queue[Symbol.asyncIterator]();
	}
}
