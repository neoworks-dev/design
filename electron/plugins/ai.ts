// main-ai: the AI harness in main (IPC domain `ai`). The renderer starts an agent session with the
// document tools it offers, sends prompts and gets the turn streamed back as `ai:event` pushes.
// When the agent calls a tool, main pushes `ai:tool-call` to the session's window and waits for
// the renderer's `ai:toolResult` (see ToolBroker); the renderer applies it through
// `document.apply`, main never touches the document.
//
// Credentials stay here: provider environment (API keys, endpoints) is read from the settings
// file under `plugins['main-ai'].providerEnv[<provider>]` and goes only into the harness process.
// Disposing the plugin ends every session, rejects pending tool calls, closes the MCP endpoint
// and removes the handlers.

import type { Plugin } from '@neoworks/extension-system';
import type { AiStreamEvent } from '../bridge';
import { McpServer, MCP_SERVER_NAME } from '../ai/mcpServer';
import { ToolBroker } from '../ai/toolBroker';
import type { AgentSession, AgentToolResult } from '../kernel/agentHost';
import type { WindowHandle } from '../kernel/host';
import { emitTo, IpcError, route } from '../kernel/route';
import { parseSettings, SETTINGS_FILE } from './settings';

export const AI_SETTINGS_PLUGIN = 'main-ai';

interface SessionRecord {
	id: string;
	window: WindowHandle;
	agent: AgentSession;
	/** The turn that is running, or `null` between turns. */
	runId: string | null;
	cancelled: boolean;
	endSession: () => Promise<void>;
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function stringRecord(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	if (typeof value !== 'object' || value === null) return result;
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string') result[key] = entry;
	}
	return result;
}

export const mainAiPlugin: Plugin.Object = {
	name: 'main-ai',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		const sessions = new Map<string, SessionRecord>();
		const mcp = new McpServer();
		let nextSessionNumber = 1;

		const broker = new ToolBroker((message) => {
			const owner = sessions.get(message.sessionId);
			if (!owner) return;
			emitTo(owner.window, 'ai:tool-call', message);
		});
		ctx.effect(
			() => () => {
				broker.cancelAll('the AI service shut down');
				void mcp.close();
			},
			'ai tool broker and mcp endpoint'
		);

		function providerEnv(provider: string): Record<string, string> {
			const settings = parseSettings(ctx.electron.userData.readText(SETTINGS_FILE));
			const own = settings.plugins[AI_SETTINGS_PLUGIN];
			if (own === undefined) return {};
			const byProvider = own.providerEnv;
			if (typeof byProvider !== 'object' || byProvider === null) return {};
			return stringRecord(Reflect.get(byProvider, provider));
		}

		function requireSession(sessionId: string, window: WindowHandle | null): SessionRecord {
			const record = sessions.get(sessionId);
			if (!record) throw new IpcError('HANDLER_FAILED', `unknown AI session ${sessionId}`);
			if (window !== null && record.window.id !== window.id) {
				throw new IpcError('FORBIDDEN_SENDER', 'that AI session belongs to another window');
			}
			return record;
		}

		function emitEvent(record: SessionRecord, runId: string, event: AiStreamEvent): void {
			emitTo(record.window, 'ai:event', { sessionId: record.id, runId, event });
		}

		async function runTurn(record: SessionRecord, runId: string, prompt: string): Promise<void> {
			try {
				for await (const event of record.agent.prompt(prompt)) {
					if (record.cancelled) break;
					emitEvent(record, runId, event);
				}
				const stopReason = record.cancelled ? 'cancelled' : 'end_turn';
				emitEvent(record, runId, { type: 'done', stopReason });
			} catch (error) {
				if (!record.cancelled)
					emitEvent(record, runId, { type: 'error', message: describe(error) });
				const stopReason = record.cancelled ? 'cancelled' : 'error';
				emitEvent(record, runId, { type: 'done', stopReason });
			} finally {
				record.runId = null;
				record.cancelled = false;
			}
		}

		route(ctx, 'ai:providers', () => ctx.electron.agents.providers());

		route(ctx, 'ai:start', async (request, event) => {
			const window = ctx.electron.windowFromSender(event.sender);
			if (!window) throw new IpcError('FORBIDDEN_SENDER', 'no window for this sender');
			const id = `ai-session-${nextSessionNumber}`;
			nextSessionNumber += 1;
			const registration = ctx.electron.agents.usesMcp
				? await mcp.register(id, {
						tools: request.tools,
						onCall: (name, input) => callTool(id, name, input)
					})
				: null;
			const releaseMcp = registration === null ? () => {} : registration.dispose;
			try {
				const agent = await ctx.electron.agents.start({
					provider: request.provider,
					model: request.model,
					system: request.system,
					tools: request.tools,
					mcp:
						registration === null
							? null
							: { name: MCP_SERVER_NAME, url: registration.url, token: registration.token },
					callTool: (name, input) => callTool(id, name, input),
					env: providerEnv(request.provider)
				});
				const record: SessionRecord = {
					id,
					window,
					agent,
					runId: null,
					cancelled: false,
					endSession: () => Promise.resolve()
				};
				const stopWatching = window.on('closed', () => void record.endSession());
				const disposeEffect = ctx.effect(
					() => () => {
						stopWatching();
						sessions.delete(id);
						releaseMcp();
						broker.cancelSession(id, 'the session ended');
						void agent.dispose();
					},
					`ai session ${id}`
				);
				record.endSession = () => disposeEffect();
				sessions.set(id, record);
				return { sessionId: id };
			} catch (error) {
				releaseMcp();
				throw error;
			}
		});

		function callTool(sessionId: string, name: string, input: unknown): Promise<AgentToolResult> {
			const record = sessions.get(sessionId);
			const runId = record === undefined || record.runId === null ? 'no-run' : record.runId;
			return broker.call(sessionId, runId, name, input);
		}

		route(ctx, 'ai:send', (request, event) => {
			const record = requireSession(request.sessionId, ctx.electron.windowFromSender(event.sender));
			if (record.runId !== null) {
				throw new IpcError('HANDLER_FAILED', 'a turn is already running in this session');
			}
			record.runId = request.runId;
			record.cancelled = false;
			void runTurn(record, request.runId, request.prompt);
		});

		route(ctx, 'ai:cancel', async (request, event) => {
			const record = requireSession(request.sessionId, ctx.electron.windowFromSender(event.sender));
			if (record.runId === null) return;
			record.cancelled = true;
			broker.cancelSession(record.id, 'the turn was cancelled');
			await record.agent.cancel();
		});

		route(ctx, 'ai:end', async (request, event) => {
			const record = requireSession(request.sessionId, ctx.electron.windowFromSender(event.sender));
			await record.endSession();
		});

		route(ctx, 'ai:toolResult', (message) => {
			broker.resolve(message);
		});
	}
};
