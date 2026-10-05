// @vitest-environment node
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiToolCallMessage } from '../bridge';
import {
	altTextFor,
	commandFor,
	contentFor,
	designFor,
	directionFor,
	matchesFor,
	renamesFor,
	taskOf
} from './qaTasks';
import { contentOf, McpServer } from './mcpServer';
import { qaScript, ScriptedAgentHost } from './scriptedAgents';
import { ToolBroker } from './toolBroker';

afterEach(() => {
	vi.useRealTimers();
});

/** The elements `html` parses into (this suite runs in node, without a DOM of its own). */
function parseHtml(html: string): Element {
	const window = new Window();
	window.document.body.innerHTML = html;
	return window.document.body as unknown as Element;
}

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
	it('qaScript draws the number of cards named in the prompt through write', async () => {
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
		expect(received.map((call) => call.name)).toEqual(['read', 'write']);
		const input = received[1].input as { html: string; label: string };
		const cards = parseHtml(input.html).children;
		expect(Array.from(cards, (card) => card.getAttribute('data-name'))).toEqual([
			'AI card 1',
			'AI card 2',
			'AI card 3',
			'AI card 4'
		]);
		expect(input.label).toBe('Draw 4 cards');
		expect(events.at(-1)).toMatchObject({ type: 'text' });
	});

	it('qaScript takes a screenshot when the prompt asks for one', async () => {
		const host = new ScriptedAgentHost(qaScript);
		const received: string[] = [];
		const session = await host.start({
			provider: 'fake',
			system: '',
			tools: [],
			mcp: null,
			env: {},
			callTool: (name) => {
				received.push(name);
				return Promise.resolve({ ok: true, text: '[]' });
			}
		});
		for await (const event of session.prompt('draw 2 cards, then take a screenshot')) {
			expect(event).toBeDefined();
		}
		expect(received).toEqual(['read', 'screenshot', 'write']);
	});
});

describe('contentOf', () => {
	it('sends an image answer as MCP image content and anything else as text', () => {
		const picture = JSON.stringify({ width: 4, height: 3, mimeType: 'image/png', base64: 'AAAA' });
		expect(contentOf({ ok: true, text: picture })).toEqual([
			{ type: 'image', data: 'AAAA', mimeType: 'image/png' },
			{ type: 'text', text: 'image 4x3' }
		]);
		expect(contentOf({ ok: true, text: '{"a":1}' })).toEqual([{ type: 'text', text: '{"a":1}' }]);
		expect(contentOf({ ok: true, text: 'plain' })).toEqual([{ type: 'text', text: 'plain' }]);
		expect(contentOf({ ok: false, text: picture })).toEqual([{ type: 'text', text: picture }]);
	});
});

describe('QA task scripts', () => {
	it('reads the task tag and names layers predictably', () => {
		const prompt = [
			'Task: rename-layers',
			'Layers (id | type | size | parent | content):',
			'- a | RECTANGLE | 10x10 | in "F"',
			'- b | RECTANGLE | 10x10 | in "F"',
			'- c | TEXT | 10x10 | in "F" | text "welcome back friend again"',
			'- d | FRAME | 10x10 | in "F" | contains x'
		].join('\n');
		expect(taskOf(prompt)).toBe('rename-layers');
		expect(taskOf('draw 3 cards')).toBeUndefined();
		expect(renamesFor(prompt)).toEqual([
			{ id: 'a', name: 'Background' },
			{ id: 'b', name: 'Background 2' },
			{ id: 'c', name: 'Welcome Back Friend' },
			{ id: 'd', name: 'Container' }
		]);
	});

	it('finds search candidates by word or alias', () => {
		const prompt = [
			'Task: search-layers',
			'Query: sign in',
			'- a | FRAME | Login form | ',
			'- b | RECTANGLE | Hero image | ',
			'- c | TEXT | Heading | Sign in to continue'
		].join('\n');
		expect(matchesFor(prompt).sort()).toEqual(['a', 'c']);
	});

	it('designs a root div of the template size, with the first component when the file has one', () => {
		const prompt = [
			'Task: generate-design',
			'Template: Basic site (1440x1024)',
			'Request: pricing page for a startup',
			'Components of this file (place one with data-component="<name>" where it fits): Button, Card'
		].join('\n');
		const parsed = parseHtml(designFor(prompt));
		expect(parsed.children).toHaveLength(1);
		const root = parsed.children[0];
		expect(root.getAttribute('data-name')).toBe('pricing page for a');
		const style = root.getAttribute('style') ?? '';
		expect(style).toContain('width:1440px');
		expect(style).toContain('height:1024px');
		expect(style).toContain('flex-direction:column');
		expect(Array.from(root.children, (child) => child.getAttribute('data-name'))).toEqual([
			'Header',
			'Hero image',
			'Cards',
			'Button',
			'Made with pricing page for a startup'
		]);
		expect(root.querySelector('[data-component]')?.getAttribute('data-component')).toBe('Button');
	});

	it('designs without a component element when the file has none', () => {
		const prompt = ['Task: generate-design', 'Template: Basic app (390x844)', 'Request: x'].join(
			'\n'
		);
		const parsed = parseHtml(designFor(prompt));
		const style = parsed.children[0].getAttribute('style') ?? '';
		expect(style).toContain('width:390px');
		expect(style).toContain('height:844px');
		expect(parsed.querySelector('[data-component]')).toBeNull();
	});

	it('maps phrases to commands and picks batch answers predictably', () => {
		expect(commandFor('align these to left')).toBe('align.left');
		expect(commandFor('Align everything to the right')).toBe('align.right');
		expect(commandFor('make me a sandwich')).toBeUndefined();
		expect(altTextFor('hero-image_2')).toBe('A picture of hero image 2.');
		expect(contentFor('Page title')).toBe('Plan your week');
		expect(contentFor('Card body')).toBe('Fresh ingredients, delivered to your door.');
		expect(directionFor('A 10x10 at 0,0; B 10x10 at 50,2')).toBe('HORIZONTAL');
		expect(directionFor('A 10x10 at 0,0; B 10x10 at 3,50')).toBe('VERTICAL');
	});
});
