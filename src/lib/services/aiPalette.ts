// The `aiPalette` service (#152): the palette's natural-language mode. Free text becomes an AI run
// that may only look (selection, layer tree) and run app commands: the run's tool list is limited
// to `list_commands` and `run_command` plus the reads, so "align these to left" ends up as the
// align command, run through the same command registry as the keyboard. The run is one undo step
// (ai-history groups what the command changed under it).

import { Service, type Context } from '@neoworks/extension-system';
import { AiConsentRequiredError, type AiEvent, type AiRunStatus } from '../ai/types';
import type { AiPaletteState } from './aiPaletteState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		aiPalette: AiPaletteService;
	}
}

/** The only tools a palette run gets. */
export const PALETTE_TOOLS: readonly string[] = [
	'list_commands',
	'run_command',
	'get_selection',
	'get_node',
	'query',
	'read_tree'
];

export interface PaletteAi {
	readonly available: boolean;
	run(
		prompt: string,
		options: { display?: string; tools?: readonly string[] }
	): { id: string; finished: Promise<AiRunStatus>; cancel(): Promise<void> };
	getRun(id: string): { events: readonly AiEvent[] } | undefined;
}

export interface PaletteContext {
	build(): { text: string };
}

/** The prompt of a palette run. The first line is the task tag the scripted QA agent keys on. */
export function paletteTaskPrompt(request: string, context: string): string {
	return [
		'Task: palette-command',
		`Request: ${request}`,
		'',
		'Do what the request asks by running app commands: find the command with list_commands',
		'(search by a word of the request), look at get_selection if the request is about the',
		'selection, then call run_command with its id (and args when it needs them). Do not edit',
		'layers in any other way. If no command does what is asked, say so in one sentence and',
		'run nothing. Answer in one short sentence.',
		'',
		'Document context:',
		context
	].join('\n');
}

function textOf(events: readonly AiEvent[]): string {
	let text = '';
	for (const event of events) {
		if (event.type === 'text') text += event.text;
	}
	return text.trim();
}

export class AiPaletteService extends Service {
	private activeRun: { cancel(): Promise<void> } | undefined;

	constructor(
		ctx: Context,
		private readonly ai: PaletteAi,
		private readonly context: PaletteContext,
		private readonly openChat: () => void,
		private readonly state: AiPaletteState
	) {
		super(ctx, 'aiPalette');
	}

	get running(): boolean {
		return this.state.running;
	}

	/** The model's one-line answer to the last request, or why nothing ran. */
	get answer(): string {
		return this.state.answer;
	}

	get canAsk(): boolean {
		return this.ai.available && !this.state.running;
	}

	dismiss(): void {
		this.state.answer = '';
	}

	async cancel(): Promise<void> {
		await this.activeRun?.cancel();
	}

	/** Run `request` as a commands-only AI run; resolves with the status when it ended. */
	async ask(request: string): Promise<AiRunStatus | undefined> {
		const text = request.trim();
		if (text === '' || this.state.running) return undefined;
		let run: ReturnType<PaletteAi['run']>;
		try {
			run = this.ai.run(paletteTaskPrompt(text, this.context.build().text), {
				display: text,
				tools: PALETTE_TOOLS
			});
		} catch (error) {
			if (!(error instanceof AiConsentRequiredError)) throw error;
			this.state.answer = 'Allow the AI for this document in the AI panel, then try again.';
			this.openChat();
			return undefined;
		}
		this.activeRun = run;
		this.state.running = true;
		this.state.answer = '';
		let status: AiRunStatus = 'error';
		try {
			status = await run.finished;
		} finally {
			this.state.running = false;
			this.activeRun = undefined;
		}
		this.state.answer = this.answerOf(run.id, status);
		return status;
	}

	snapshotState(): Record<string, unknown> {
		return { running: this.state.running };
	}

	private answerOf(runId: string, status: AiRunStatus): string {
		if (status === 'cancelled') return 'Stopped.';
		let text = '';
		const record = this.ai.getRun(runId);
		if (record !== undefined) text = textOf(record.events);
		if (status === 'error' && text === '') return 'The AI could not do that.';
		if (status === 'error') return text;
		if (text === '') return 'Done.';
		return text;
	}
}
