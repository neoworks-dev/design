// A stand-in for main-ai in renderer tests: implements the bridge's `ai` section and plays the
// agent from a script, pushing `ai:event` and `ai:tool-call` like the real main does. No model,
// no IPC. Used by the ai, ai-tools, ai-history and ai-chat tests.

import type {
	AiProviderInfo,
	AiStartRequest,
	AiStreamEvent,
	AiToolResultMessage,
	DesktopBridge,
	IpcEventChannel,
	IpcEvents
} from '../../../electron/bridge';

export interface FakeTurn {
	runId: string;
	prompt: string;
	send(event: AiStreamEvent): void;
	/** Ask the renderer to run a tool and wait for its answer, like main's tool broker. */
	callTool(tool: string, input: unknown): Promise<{ ok: boolean; text: string }>;
	/** True once the renderer cancelled this turn. */
	cancelled(): boolean;
}
export type FakeScript = (turn: FakeTurn) => Promise<void>;

export const FAKE_PROVIDER: AiProviderInfo = {
	id: 'fake',
	label: 'Scripted agent',
	available: true,
	models: [{ id: 'scripted-1', name: 'Scripted 1' }]
};

export class FakeAiMain {
	script: FakeScript = () => Promise.resolve();
	providers: AiProviderInfo[] = [FAKE_PROVIDER];
	readonly started: AiStartRequest[] = [];
	readonly sent: { sessionId: string; runId: string; prompt: string }[] = [];
	readonly ended: string[] = [];
	cancels = 0;
	/** Observes every answer the renderer sends for a tool call. */
	onToolResult: (result: AiToolResultMessage) => void = () => {};
	private nextSession = 1;
	private nextCall = 1;
	private readonly cancelledRuns = new Set<string>();
	private readonly pending = new Map<string, (result: { ok: boolean; text: string }) => void>();

	constructor(
		private readonly emit: <Channel extends IpcEventChannel>(
			channel: Channel,
			payload: IpcEvents[Channel]
		) => void
	) {}

	readonly section: DesktopBridge['ai'] = {
		providers: () => Promise.resolve(this.providers),
		start: (request) => {
			this.started.push(request);
			const sessionId = `session-${this.nextSession}`;
			this.nextSession += 1;
			return Promise.resolve({ sessionId });
		},
		send: (request) => {
			this.sent.push(request);
			void this.playTurn(request.sessionId, request.runId, request.prompt);
			return Promise.resolve();
		},
		cancel: () => {
			this.cancels += 1;
			for (const runId of this.runsInFlight) this.cancelledRuns.add(runId);
			return Promise.resolve();
		},
		end: (sessionId) => {
			this.ended.push(sessionId);
			return Promise.resolve();
		},
		toolResult: (result: AiToolResultMessage) => {
			this.onToolResult(result);
			const resolve = this.pending.get(result.callId);
			this.pending.delete(result.callId);
			if (resolve) resolve({ ok: result.ok, text: result.text });
			return Promise.resolve();
		}
	};

	private readonly runsInFlight = new Set<string>();

	private async playTurn(sessionId: string, runId: string, prompt: string): Promise<void> {
		this.runsInFlight.add(runId);
		const turn: FakeTurn = {
			runId,
			prompt,
			send: (event) => this.emit('ai:event', { sessionId, runId, event }),
			callTool: (tool, input) => {
				const callId = `call-${this.nextCall}`;
				this.nextCall += 1;
				return new Promise((resolve) => {
					this.pending.set(callId, resolve);
					this.emit('ai:tool-call', { sessionId, runId, callId, tool, input });
				});
			},
			cancelled: () => this.cancelledRuns.has(runId)
		};
		try {
			await this.script(turn);
			const stopReason = this.cancelledRuns.has(runId) ? 'cancelled' : 'end_turn';
			turn.send({ type: 'done', stopReason });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			turn.send({ type: 'error', message });
			turn.send({ type: 'done', stopReason: 'error' });
		} finally {
			this.runsInFlight.delete(runId);
		}
	}
}
