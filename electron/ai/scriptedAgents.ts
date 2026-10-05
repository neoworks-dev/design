// An agent host that follows a script instead of calling a model. Unit tests give it their own
// scripts; `DESIGN_QA_AI=fake` plugs `qaScript` into the real main process so the chat panel can be
// driven and screenshotted without credentials or network. A script is an async generator: it
// yields what the model would stream and calls document tools through `tools.call`.

import type { AiProviderInfo, AiStreamEvent } from '../bridge';
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
	models: [{ id: 'scripted-1', name: 'Scripted 1' }]
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
	private running: AbortController | null = null;

	constructor(
		readonly init: AgentStartInit,
		private readonly script: () => AgentScript
	) {}

	async *prompt(text: string): AsyncGenerator<AiStreamEvent> {
		this.prompts.push(text);
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
 * the prompt, default 3) in one `apply_changes` call, so a run is easy to undo and to check.
 */
export async function* qaScript(prompt: string, tools: ScriptTools): AsyncGenerator<AiStreamEvent> {
	yield { type: 'thought', text: 'Checking the selection and what is on the page first.' };
	yield { type: 'tool_call', callId: 'qa-1', name: 'get_selection', status: 'running' };
	const selection = await tools.call('get_selection', {});
	yield { type: 'tool_call', callId: 'qa-1', name: 'get_selection', status: 'done' };
	yield { type: 'text', text: `Selection: ${textOf(selection).slice(0, 120)}\n\n` };

	const count = countIn(prompt);
	const operations = [];
	for (let position = 0; position < count; position += 1) {
		operations.push({
			op: 'create',
			type: 'RECTANGLE',
			props: {
				name: `AI card ${position + 1}`,
				x: position * 140,
				y: 0,
				width: 120,
				height: 80,
				cornerRadius: 8,
				fill: '#6d5bd0'
			}
		});
	}
	const input = { label: `Draw ${count} cards`, ops: operations };
	yield { type: 'tool_call', callId: 'qa-2', name: 'apply_changes', input, status: 'running' };
	const result = await tools.call('apply_changes', input);
	yield {
		type: 'tool_call',
		callId: 'qa-2',
		name: 'apply_changes',
		status: result.ok ? 'done' : 'failed'
	};
	if (!result.ok) {
		yield { type: 'text', text: `That did not work: ${result.text}` };
		return;
	}
	yield { type: 'text', text: `Done: I drew ${count} cards. You can undo the whole run at once.` };
}
