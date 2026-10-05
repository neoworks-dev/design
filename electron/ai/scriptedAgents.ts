// An agent host that follows a script instead of calling a model. Unit tests give it their own
// scripts; `DESIGN_QA_AI=fake` plugs `qaScript` into the real main process so the chat panel can be
// driven and screenshotted without credentials or network. A script is an async generator: it
// yields what the model would stream and calls document tools through `tools.call`.

import type { AiImage, AiProviderInfo, AiStreamEvent } from '../bridge';
import { taskOf, TASK_SCRIPTS } from './qaTasks';
import type { AgentHost, AgentSession, AgentStartInit, AgentToolResult } from '../kernel/agentHost';

export interface ScriptTools {
	call(name: string, input: unknown): Promise<AgentToolResult>;
}
/** A script may be a plain generator when it never awaits. */
export type AgentScript = (
	prompt: string,
	tools: ScriptTools
) => AsyncIterator<AiStreamEvent> | Iterator<AiStreamEvent>;

export const SCRIPTED_PROVIDER: AiProviderInfo = {
	id: 'fake',
	label: 'Scripted agent',
	available: true,
	detail: 'No model: follows a fixed script',
	models: [{ id: 'scripted-1', name: 'Scripted 1' }],
	images: true,
	efforts: ['low', 'high']
};

/** Resolves with `undefined` once `signal` aborts; used to stop waiting on a script. */
function whenAborted(signal: AbortSignal): Promise<undefined> {
	return new Promise((resolve) => {
		if (signal.aborted) resolve(undefined);
		signal.addEventListener('abort', () => resolve(undefined), { once: true });
	});
}

export class ScriptedAgentSession implements AgentSession {
	cancelCount = 0;
	disposed = false;
	readonly prompts: string[] = [];
	/** The images sent with each prompt, in the same order as `prompts`. */
	readonly images: AiImage[][] = [];
	private running: AbortController | null = null;

	constructor(
		readonly init: AgentStartInit,
		private readonly script: () => AgentScript
	) {}

	async *prompt(text: string, images: AiImage[] = []): AsyncGenerator<AiStreamEvent> {
		this.prompts.push(text);
		this.images.push(images);
		const controller = new AbortController();
		this.running = controller;
		const signal = controller.signal;
		const tools: ScriptTools = {
			call: (name, input) => {
				if (signal.aborted) return Promise.reject(new Error('cancelled'));
				return this.init.callTool(name, input);
			}
		};
		const iterator = this.script()(text, tools);
		const aborted = whenAborted(signal);
		try {
			while (!signal.aborted) {
				const next = await Promise.race([iterator.next(), aborted]);
				if (next === undefined || next.done) return;
				yield next.value;
			}
		} finally {
			if (this.running === controller) this.running = null;
			void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
		}
	}

	cancel(): Promise<void> {
		this.cancelCount += 1;
		this.running?.abort();
		return Promise.resolve();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.cancel();
	}
}

export class ScriptedAgentHost implements AgentHost {
	readonly usesMcp = false;
	readonly sessions: ScriptedAgentSession[] = [];
	script: AgentScript;
	providerList: AiProviderInfo[] = [SCRIPTED_PROVIDER];

	constructor(script: AgentScript) {
		this.script = script;
	}

	providers(): Promise<AiProviderInfo[]> {
		return Promise.resolve(this.providerList);
	}

	start(init: AgentStartInit): Promise<ScriptedAgentSession> {
		const session = new ScriptedAgentSession(init, () => this.script);
		this.sessions.push(session);
		return Promise.resolve(session);
	}

	/** Sessions that were started and not disposed. */
	liveSessions(): number {
		return this.sessions.filter((session) => !session.disposed).length;
	}
}

// ---------- the QA script ----------

function countIn(prompt: string): number {
	const match = /\b(\d{1,2})\b/.exec(prompt);
	if (!match) return 3;
	return Math.max(1, Math.min(30, Number(match[1])));
}

function textOf(result: AgentToolResult): string {
	if (result.ok) return result.text;
	return `error: ${result.text}`;
}

/**
 * Looks at the selection and the page, then draws N rectangles in a row (N is the first number in
 * the prompt, default 3) in one `write` call, so a run is easy to undo and to check.
 */
export async function* qaScript(prompt: string, tools: ScriptTools): AsyncGenerator<AiStreamEvent> {
	const task = taskOf(prompt);
	if (task !== undefined && TASK_SCRIPTS[task] !== undefined) {
		yield* TASK_SCRIPTS[task](prompt, tools);
		return;
	}
	yield { type: 'thought', text: 'Checking the selection and what is on the page first.' };
	yield { type: 'tool_call', callId: 'qa-1', name: 'read', status: 'running' };
	const selection = await tools.call('read', {});
	yield { type: 'tool_call', callId: 'qa-1', name: 'read', status: 'done' };
	yield { type: 'text', text: `Selection: ${textOf(selection).slice(0, 120)}\n\n` };

	const attached = /\[Selection \((\d+)\)\]\n/.exec(prompt);
	if (attached) {
		yield { type: 'text', text: `Context attached: ${attached[1]} selected layers.\n\n` };
	}
	if (/screenshot/i.test(prompt)) {
		yield { type: 'tool_call', callId: 'qa-shot', name: 'screenshot', status: 'running' };
		const shot = await tools.call('screenshot', {});
		yield {
			type: 'tool_call',
			callId: 'qa-shot',
			name: 'screenshot',
			status: shot.ok ? 'done' : 'failed'
		};
		yield { type: 'text', text: `Screenshot: ${shot.ok ? 'received' : textOf(shot)}\n\n` };
	}

	const count = countIn(prompt.split('\n')[0]);
	const cards: string[] = [];
	for (let position = 0; position < count; position += 1) {
		cards.push(
			`<div data-name="AI card ${position + 1}" style="position:absolute;left:${position * 140}px;top:0;width:120px;height:80px;border-radius:8px;background:#6d5bd0"></div>`
		);
	}
	const input = { label: `Draw ${count} cards`, html: cards.join('') };
	yield { type: 'tool_call', callId: 'qa-2', name: 'write', input, status: 'running' };
	const result = await tools.call('write', input);
	yield {
		type: 'tool_call',
		callId: 'qa-2',
		name: 'write',
		status: result.ok ? 'done' : 'failed'
	};
	if (!result.ok) {
		yield { type: 'text', text: `That did not work: ${result.text}` };
		return;
	}
	yield { type: 'text', text: `Done: I drew ${count} cards. You can undo the whole run at once.` };
}
