// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiToolCallMessage } from '../bridge';
import { McpServer } from './mcpServer';
import { qaScript, ScriptedAgentHost } from './scriptedAgents';
import { ToolBroker } from './toolBroker';

afterEach(() => {
	vi.useRealTimers();
});

describe('ToolBroker', () => {
	it('resolves a call with the renderer answer', async () => {
		const pushed: AiToolCallMessage[] = [];
		const broker = new ToolBroker((message) => pushed.push(message));
		const result = broker.call('s', 'r', 'read_tree', { depth: 2 });
		expect(broker.pendingCount).toBe(1);
		broker.resolve({ callId: pushed[0].callId, ok: true, text: 'tree' });
		expect(await result).toEqual({ ok: true, text: 'tree' });
		expect(broker.pendingCount).toBe(0);
	});

	it('times out a call nobody answers', async () => {
		vi.useFakeTimers();
		const broker = new ToolBroker(() => {}, 1000);
		const result = broker.call('s', 'r', 'read_tree', {});
		vi.advanceTimersByTime(1001);
		expect(await result).toEqual({ ok: false, text: 'tool read_tree timed out' });
		expect(broker.pendingCount).toBe(0);
	});

	it('cancels only the calls of one session and ignores late answers', async () => {
		const pushed: AiToolCallMessage[] = [];
		const broker = new ToolBroker((message) => pushed.push(message));
		const mine = broker.call('a', 'r', 'x', {});
		const theirs = broker.call('b', 'r', 'x', {});
		broker.cancelSession('a', 'stopped');
		expect(await mine).toEqual({ ok: false, text: 'stopped' });
		expect(broker.pendingCount).toBe(1);
		broker.resolve({ callId: pushed[0].callId, ok: true, text: 'late' });
		broker.resolve({ callId: pushed[1].callId, ok: true, text: 'fine' });
		expect(await theirs).toEqual({ ok: true, text: 'fine' });
	});
});

describe('McpServer', () => {
	async function rpc(
		url: string,
		token: string,
		body: unknown
	): Promise<{ status: number; json: unknown }> {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify(body)
		});
		const text = await response.text();
		return { status: response.status, json: text === '' ? null : JSON.parse(text) };
	}

	it('serves tools over JSON-RPC and forwards calls, guarded by a token', async () => {
		const server = new McpServer();
		const calls: unknown[] = [];
		const registration = await server.register('s1', {
			tools: [
				{ name: 'read_tree', description: 'd', inputSchema: { type: 'object' }, write: false }
			],
			onCall: (name, input) => {
				calls.push([name, input]);
				return Promise.resolve({ ok: true, text: 'ok' });
			}
		});
		try {
			const init = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {}
			});
			expect(init.json).toMatchObject({ result: { serverInfo: { name: 'design' } } });
			const notification = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				method: 'notifications/initialized'
			});
			expect(notification.status).toBe(202);
			const list = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list'
			});
			expect(list.json).toMatchObject({ result: { tools: [{ name: 'read_tree' }] } });
			const called = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: { name: 'read_tree', arguments: { depth: 1 } }
			});
			expect(called.json).toMatchObject({
				result: { content: [{ type: 'text', text: 'ok' }], isError: false }
			});
			expect(calls).toEqual([['read_tree', { depth: 1 }]]);
			const unknown = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: { name: 'format_disk' }
			});
			expect(unknown.json).toMatchObject({ result: { isError: true } });
			const forbidden = await rpc(registration.url, 'wrong', {
				jsonrpc: '2.0',
				id: 5,
				method: 'ping'
			});
			expect(forbidden.status).toBe(401);
		} finally {
			await server.close();
		}
		expect(server.listening).toBe(false);
	});

	it('stops serving a session once it is released', async () => {
		const server = new McpServer();
		const registration = await server.register('s1', {
			tools: [],
			onCall: () => Promise.resolve({ ok: true, text: '' })
		});
		try {
			registration.dispose();
			const answer = await rpc(registration.url, registration.token, {
				jsonrpc: '2.0',
				id: 1,
				method: 'ping'
			});
			expect(answer.status).toBe(401);
		} finally {
			await server.close();
		}
	});
});

describe('scripted agent', () => {
	it('qaScript draws the number of cards named in the prompt through apply_changes', async () => {
		const host = new ScriptedAgentHost(qaScript);
		const received: { name: string; input: unknown }[] = [];
		const session = await host.start({
			provider: 'fake',
			system: '',
			tools: [],
			mcp: null,
			env: {},
			callTool: (name, input) => {
				received.push({ name, input });
				return Promise.resolve({ ok: true, text: '[]' });
			}
		});
		const events = [];
		for await (const event of session.prompt('draw 4 cards')) events.push(event);
		expect(received.map((call) => call.name)).toEqual(['get_selection', 'apply_changes']);
		const input = received[1].input as { ops: unknown[] };
		expect(input.ops).toHaveLength(4);
		expect(events.at(-1)).toMatchObject({ type: 'text' });
	});
});
