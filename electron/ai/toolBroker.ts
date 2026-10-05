// Round trips of tool calls from an agent in main to the renderer that owns the document. A call
// is pushed as `ai:tool-call`; the renderer answers through the `ai:toolResult` route. Every call
// has a timeout and can be cancelled (the turn was stopped, the session ended), so a vanished
// renderer never leaves an agent waiting.

import type { AiToolCallMessage, AiToolResultMessage } from '../bridge';
import type { AgentToolResult } from '../kernel/agentHost';

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

interface PendingCall {
	sessionId: string;
	settle: (result: AgentToolResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class ToolBroker {
	private readonly pending = new Map<string, PendingCall>();
	private nextCallNumber = 1;

	constructor(
		private readonly push: (message: AiToolCallMessage) => void,
		private readonly timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
	) {}

	get pendingCount(): number {
		return this.pending.size;
	}

	/** Ask the renderer to run `tool`; resolves with its answer, or a failure on timeout/cancel. */
	call(sessionId: string, runId: string, tool: string, input: unknown): Promise<AgentToolResult> {
		const callId = `call-${this.nextCallNumber}`;
		this.nextCallNumber += 1;
		return new Promise<AgentToolResult>((resolve) => {
			const timer = setTimeout(
				() => this.finish(callId, { ok: false, text: `tool ${tool} timed out` }),
				this.timeoutMs
			);
			this.pending.set(callId, { sessionId, settle: resolve, timer });
			this.push({ sessionId, runId, callId, tool, input });
		});
	}

	/** The renderer's answer. Unknown ids (already timed out or cancelled) are ignored. */
	resolve(message: AiToolResultMessage): void {
		this.finish(message.callId, { ok: message.ok, text: message.text });
	}

	/** Fail every pending call of one session (turn cancelled or session ended). */
	cancelSession(sessionId: string, reason: string): void {
		for (const [callId, call] of this.pending) {
			if (call.sessionId === sessionId) this.finish(callId, { ok: false, text: reason });
		}
	}

	cancelAll(reason: string): void {
		for (const callId of this.pending.keys()) this.finish(callId, { ok: false, text: reason });
	}

	private finish(callId: string, result: AgentToolResult): void {
		const call = this.pending.get(callId);
		if (!call) return;
		this.pending.delete(callId);
		clearTimeout(call.timer);
		call.settle(result);
	}
}
