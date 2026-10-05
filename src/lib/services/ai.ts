// The `ai` service: the renderer's typed API over the AI bridge (main-ai).
//
//   const run = ctx.ai.run('Make the buttons rounder', { scope: 'write' });
//   for await (const event of run) { ... }   // text, thought, tool_call, edit, done, error
//   await run.cancel();
//
// What it owns:
//   - the run registry: id, status, origin tag (`ai`) and the events so far, reactive, for the chat
//     panel and the history grouping (kernel events `ai/run-start`, `ai/edit`, `ai/run-end`)
//   - the tool registry: plugins register the document tools the agent may call (`ai-tools`);
//     calls arrive from main as `ai:tool-call`, run here (writes go through `document.apply`)
//     and are answered with `ai:toolResult`
//   - consent: a document is only sent to a model after the user allowed it, per document
//   - one agent session per window, restarted when the provider, model, tools or document change
//
// Main never touches the document; this service is the only door between agent and document.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	AiEventMessage,
	AiProviderInfo,
	AiSendRequest,
	AiStartRequest,
	AiToolCallMessage,
	AiToolDefinition,
	AiToolResultMessage
} from '../../../electron/bridge';
import { buildSystemPrompt } from '../ai/systemPrompt';
import {
	AiConsentRequiredError,
	AiEventQueue,
	AiRun,
	AiUnavailableError,
	appendAiEvent,
	summarizePrompt,
	type AiEditSummary,
	type AiEvent,
	type AiRunInfo,
	type AiRunOptions,
	type AiRunRecord,
	type AiRunStatus,
	type AiToolHandler
} from '../ai/types';
import { Registry } from '../registries/registry.svelte';
import type { DocumentService } from './document';
import type { AiState } from './aiState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		ai: AiService;
	}
	interface Events {
		/** Dispatch mode: emit. A run was accepted; nothing has been written yet. */
		'ai/run-start'(run: AiRunInfo): void;
		/** Dispatch mode: emit. A write tool changed the document during `run`. */
		'ai/edit'(run: AiRunInfo, edit: AiEditSummary): void;
		/** Dispatch mode: emit. The run finished, was cancelled or failed; no more writes follow. */
		'ai/run-end'(run: AiRunInfo, status: AiRunStatus): void;
	}
}

/** The part of the `desktop` service the AI uses (the library may not import plugins). */
export interface AiDesktop {
	readonly isNative: boolean;
	aiProviders(): Promise<AiProviderInfo[]>;
	aiStart(request: AiStartRequest): Promise<{ sessionId: string }>;
	aiSend(request: AiSendRequest): Promise<void>;
	aiCancel(sessionId: string): Promise<void>;
	aiEnd(sessionId: string): Promise<void>;
	aiToolResult(result: AiToolResultMessage): Promise<void>;
}

export interface AiServiceOptions {
	/** Provider used when neither the run nor the user picked one. */
	defaultProvider?: string;
	defaultModel?: string;
	/** Ask the user before a document is sent to a model (default true). */
	requireConsent?: boolean;
	now?: () => number;
}

interface RunHandle {
	queue: AiEventQueue;
	resolveFinished: (status: AiRunStatus) => void;
	attachments: string[];
}

function toolSignature(definitions: AiToolDefinition[]): string {
	return definitions
		.map((definition) => definition.name)
		.sort()
		.join(',');
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class AiService extends Service {
	/** The document tools plugins offer to the agent. */
	readonly tools = new Registry<AiToolHandler>();
	private readonly handles = new Map<string, RunHandle>();
	private nextRunNumber = 1;

	constructor(
		ctx: Context,
		private readonly desktop: AiDesktop,
		private readonly document: DocumentService,
		private readonly state: AiState,
		private readonly options: AiServiceOptions = {}
	) {
		super(ctx, 'ai');
	}

	// ---------- reads (reactive) ----------

	/** False in a plain browser: there is no main process to run a harness. */
	get available(): boolean {
		return this.desktop.isNative;
	}

	/** Every run since the app started, oldest first. */
	runs(): readonly AiRunRecord[] {
		return this.state.runs;
	}

	getRun(id: string): AiRunRecord | undefined {
		return this.state.runs.find((record) => record.id === id);
	}

	/** The run that is streaming now, if any. */
	get activeRun(): AiRunRecord | undefined {
		return this.state.runs.find((record) => record.status === 'running');
	}

	get providers(): readonly AiProviderInfo[] {
		return this.state.providers;
	}

	get providerId(): string {
		if (this.state.providerId !== '') return this.state.providerId;
		if (this.options.defaultProvider !== undefined) return this.options.defaultProvider;
		const first = this.state.providers.find((provider) => provider.available);
		if (first === undefined) return '';
		return first.id;
	}

	get modelId(): string {
		if (this.state.modelId !== '') return this.state.modelId;
		if (this.options.defaultModel !== undefined) return this.options.defaultModel;
		return '';
	}

	hasConsent(documentId: string): boolean {
		if (this.options.requireConsent === false) return true;
		return this.state.consented.includes(documentId);
	}

	// ---------- setup ----------

	/** Choose what the next run uses; an empty model means the provider's default. */
	selectModel(providerId: string, modelId: string): void {
		this.state.providerId = providerId;
		this.state.modelId = modelId;
	}

	grantConsent(documentId: string): void {
		if (this.state.consented.includes(documentId)) return;
		this.state.consented = [...this.state.consented, documentId];
	}

	revokeConsent(documentId: string): void {
		this.state.consented = this.state.consented.filter((id) => id !== documentId);
	}

	/** Ask main which harnesses exist; the result is kept for `providers`. */
	async refreshProviders(): Promise<readonly AiProviderInfo[]> {
		if (!this.available) return [];
		this.state.providers = await this.desktop.aiProviders();
		return this.state.providers;
	}

	registerTool(handler: AiToolHandler): () => void {
		return this.tools.register(handler);
	}

	// ---------- runs ----------

	/**
	 * Start a run. Throws `AiConsentRequiredError` until the document was allowed; later failures
	 * (no harness, a failing turn) arrive as an `error` event and status `error`.
	 */
	run(prompt: string, options: AiRunOptions = {}): AiRun {
		const documentId = this.document.documentId;
		if (!this.hasConsent(documentId)) throw new AiConsentRequiredError(documentId);
		const info = this.createInfo(prompt, options, documentId);
		const queue = new AiEventQueue();
		const finished = new Promise<AiRunStatus>((resolve) => {
			this.handles.set(info.id, {
				queue,
				resolveFinished: resolve,
				attachments: (options.attachments ?? []).map((item) => `[${item.label}]\n${item.text}`)
			});
		});
		const record: AiRunRecord = {
			...info,
			status: 'running',
			events: [],
			endedAt: null,
			error: null
		};
		this.state.runs = [...this.state.runs, record];
		this.ctx.emit('ai/run-start', info);
		void this.execute(info.id);
		return new AiRun(info, queue, finished, () => this.cancel(info.id));
	}

	/** Stop a run: main cancels the harness turn; the run ends as `cancelled`. */
	async cancel(runId: string): Promise<void> {
		const record = this.getRun(runId);
		if (!record || record.status !== 'running') return;
		const session = this.state.session;
		if (session !== null) {
			await this.desktop.aiCancel(session.sessionId).catch((error: unknown) => {
				this.ctx.logger.warn(`ai: cancel failed: ${describeError(error)}`);
			});
		}
		this.finish(runId, 'cancelled');
	}

	/** The run a write tool belongs to reports what it changed (chat row, audit trail). */
	reportEdit(runId: string, edit: AiEditSummary): void {
		const record = this.getRun(runId);
		if (!record) return;
		this.pushEvent(runId, { type: 'edit', edit });
		this.ctx.emit('ai/edit', this.infoOf(record), edit);
	}

	/** The run whose command is executing now (see `withRun`), or `null`. */
	get attributedRun(): AiRunInfo | null {
		return this.state.attributedRun;
	}

	/**
	 * Run `work` (a command the agent asked for) on behalf of `run`: while it runs, document
	 * changes that carry no origin of their own are attributed to the run (ai-history reads this).
	 */
	async withRun<T>(run: AiRunInfo, work: () => Promise<T>): Promise<T> {
		const previous = this.state.attributedRun;
		this.state.attributedRun = run;
		try {
			return await work();
		} finally {
			this.state.attributedRun = previous;
		}
	}

	/** Cancel what runs and end the session: the plugin is unloading. */
	async shutdown(): Promise<void> {
		for (const record of this.state.runs) {
			if (record.status === 'running') this.finish(record.id, 'cancelled');
		}
		const session = this.state.session;
		this.state.session = null;
		if (session === null) return;
		await this.desktop.aiEnd(session.sessionId).catch(() => undefined);
	}

	snapshotState(): Record<string, unknown> {
		return { running: this.state.runs.filter((record) => record.status === 'running').length };
	}

	// ---------- from main (wired by the plugin) ----------

	/** An `ai:event` push: a streamed event of a turn. */
	handleStreamEvent(message: AiEventMessage): void {
		const record = this.getRun(message.runId);
		if (!record || record.status !== 'running') return;
		const event = message.event;
		if (event.type === 'done') {
			this.finish(record.id, statusOfStop(event.stopReason), event.stopReason);
			return;
		}
		if (event.type === 'error') {
			this.pushEvent(record.id, event);
			this.updateRun(record.id, { error: event.message });
			return;
		}
		this.pushEvent(record.id, event);
	}

	/** An `ai:tool-call` push: run the registered tool and answer main. */
	async handleToolCall(message: AiToolCallMessage): Promise<void> {
		const result = await this.runTool(message);
		await this.desktop
			.aiToolResult({ callId: message.callId, ok: result.ok, text: result.text })
			.catch((error: unknown) => {
				this.ctx.logger.warn(`ai: could not answer ${message.tool}: ${describeError(error)}`);
			});
	}

	// ---------- internals ----------

	private async runTool(message: AiToolCallMessage): Promise<{ ok: boolean; text: string }> {
		const record = this.getRun(message.runId);
		if (!record || record.status !== 'running') {
			return { ok: false, text: 'this run is not active any more' };
		}
		const handler = this.tools.get(message.tool);
		if (!handler) {
			const known = this.tools
				.list()
				.map((tool) => tool.id)
				.join(', ');
			return { ok: false, text: `unknown tool "${message.tool}"; available: ${known}` };
		}
		if (handler.write && record.scope === 'read') {
			return {
				ok: false,
				text: `"${message.tool}" changes the document and this run is read-only`
			};
		}
		try {
			return { ok: true, text: await handler.run(message.input, this.infoOf(record)) };
		} catch (error) {
			return { ok: false, text: describeError(error) };
		}
	}

	private createInfo(prompt: string, options: AiRunOptions, documentId: string): AiRunInfo {
		const now = this.options.now ?? Date.now;
		const id = `ai-run-${this.nextRunNumber}-${now().toString(36)}`;
		this.nextRunNumber += 1;
		let provider = options.provider;
		if (provider === undefined) provider = this.providerId;
		let model = options.model;
		if (model === undefined) model = this.modelId;
		return {
			id,
			label: summarizePrompt(options.display === undefined ? prompt : options.display),
			prompt,
			display: options.display,
			origin: 'ai',
			scope: options.scope === undefined ? 'write' : options.scope,
			provider,
			model: model === '' ? null : model,
			documentId,
			startedAt: now()
		};
	}

	private infoOf(record: AiRunRecord): AiRunInfo {
		return {
			id: record.id,
			label: record.label,
			prompt: record.prompt,
			display: record.display,
			origin: record.origin,
			scope: record.scope,
			provider: record.provider,
			model: record.model,
			documentId: record.documentId,
			startedAt: record.startedAt
		};
	}

	private async execute(runId: string): Promise<void> {
		try {
			const sessionId = await this.ensureSession(runId);
			const record = this.getRun(runId);
			const handle = this.handles.get(runId);
			if (!record || !handle || record.status !== 'running') return;
			const parts = [record.prompt, ...handle.attachments];
			await this.desktop.aiSend({ sessionId, runId, prompt: parts.join('\n\n') });
		} catch (error) {
			const record = this.getRun(runId);
			if (!record || record.status !== 'running') return;
			this.pushEvent(runId, { type: 'error', message: describeError(error) });
			this.updateRun(runId, { error: describeError(error) });
			this.finish(runId, 'error');
		}
	}

	private definitionsFor(record: AiRunRecord): AiToolDefinition[] {
		return this.tools
			.list()
			.filter((tool) => tool.write === false || record.scope === 'write')
			.map((tool) => ({
				name: tool.id,
				description: tool.description,
				inputSchema: tool.inputSchema,
				write: tool.write
			}));
	}

	private async ensureSession(runId: string): Promise<string> {
		const record = this.getRun(runId);
		if (!record) throw new Error('unknown run');
		if (!this.available) {
			throw new AiUnavailableError('the AI agent needs the desktop app');
		}
		const provider = await this.resolveProvider(record);
		const definitions = this.definitionsFor(record);
		const signature = `${record.scope}:${toolSignature(definitions)}`;
		const current = this.state.session;
		if (
			current !== null &&
			current.provider === provider &&
			current.model === record.model &&
			current.toolSignature === signature &&
			current.documentId === record.documentId
		) {
			return current.sessionId;
		}
		if (current !== null) await this.desktop.aiEnd(current.sessionId).catch(() => undefined);
		this.state.session = null;
		const started = await this.desktop.aiStart({
			provider,
			model: record.model === null ? undefined : record.model,
			system: buildSystemPrompt({
				documentName: this.document.documentName,
				pageName: this.document.currentPage.name,
				canWrite: record.scope === 'write'
			}),
			tools: definitions
		});
		this.state.session = {
			sessionId: started.sessionId,
			provider,
			model: record.model,
			toolSignature: signature,
			documentId: record.documentId
		};
		return started.sessionId;
	}

	private async resolveProvider(record: AiRunRecord): Promise<string> {
		if (record.provider !== '') return record.provider;
		const providers = await this.refreshProviders();
		const first = providers.find((provider) => provider.available);
		if (first === undefined) {
			throw new AiUnavailableError('no AI harness is installed or logged in');
		}
		this.updateRun(record.id, { provider: first.id });
		return first.id;
	}

	private pushEvent(runId: string, event: AiEvent): void {
		const record = this.getRun(runId);
		if (!record) return;
		this.updateRun(runId, { events: appendAiEvent(record.events, event) });
		this.handles.get(runId)?.queue.push(event);
	}

	private updateRun(runId: string, patch: Partial<AiRunRecord>): void {
		this.state.runs = this.state.runs.map((record) =>
			record.id === runId ? { ...record, ...patch } : record
		);
	}

	private finish(runId: string, status: AiRunStatus, reason?: string): void {
		const handle = this.handles.get(runId);
		const record = this.getRun(runId);
		if (!handle || !record || record.status !== 'running') return;
		this.handles.delete(runId);
		const stopReason = reason === undefined ? defaultStopReason(status) : reason;
		this.updateRun(runId, {
			status,
			endedAt: (this.options.now ?? Date.now)(),
			events: appendAiEvent(record.events, { type: 'done', stopReason })
		});
		handle.queue.push({ type: 'done', stopReason });
		handle.queue.end();
		handle.resolveFinished(status);
		this.ctx.emit('ai/run-end', this.infoOf(record), status);
	}
}

function defaultStopReason(status: AiRunStatus): string {
	if (status === 'done') return 'end_turn';
	return status;
}

function statusOfStop(stopReason: string): AiRunStatus {
	if (stopReason === 'cancelled') return 'cancelled';
	if (stopReason === 'error') return 'error';
	return 'done';
}
