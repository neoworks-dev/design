import { describe, expect, it } from 'vitest';
import type {
	AiEventMessage,
	AiStartRequest,
	AiStreamEvent,
	AiToolCallMessage,
	IpcResult
} from '../bridge';
import type { AgentScript } from '../ai/scriptedAgents';
import type { FakeWindow } from '../kernel/fakeHost';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import { mainAiPlugin } from './ai';
import { SETTINGS_FILE } from './settings';

type Kernel = TestKernel & { window: FakeWindow };

const START: AiStartRequest = {
	provider: 'fake',
	system: 'You edit designs.',
	tools: [
		{
			name: 'read_tree',
			description: 'Read the tree',
			inputSchema: { type: 'object', properties: {} },
			write: false
		}
	]
};

function boot(files: Record<string, string> = {}): Promise<Kernel> {
	return bootMinimalKernel([{ plugin: mainAiPlugin }], { files });
}

async function call<T>(kernel: Kernel, channel: string, payload?: unknown): Promise<IpcResult<T>> {
	return (await kernel.host.invoke(channel, payload)) as IpcResult<T>;
}

function value<T>(result: IpcResult<T>): T {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
}

async function startSession(kernel: Kernel): Promise<string> {
	return value(await call<{ sessionId: string }>(kernel, 'ai:start', START)).sessionId;
}

function events(kernel: Kernel): AiStreamEvent[] {
	return kernel.window.sent
		.filter((message) => message.channel === 'ai:event')
		.map((message) => (message.payload as AiEventMessage).event);
}

function toolCalls(kernel: Kernel): AiToolCallMessage[] {
	return kernel.window.sent
		.filter((message) => message.channel === 'ai:tool-call')
		.map((message) => message.payload as AiToolCallMessage);
}

async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50 && !condition(); attempt += 1) await settle();
}

describe('main-ai', () => {
	it('registers the ai routes and removes them on unload', async () => {
		const kernel = await boot();
		const channels = [
			'ai:providers',
			'ai:start',
			'ai:send',
			'ai:cancel',
			'ai:end',
			'ai:toolResult'
		];
		expect(kernel.host.snapshot().handlers).toEqual(expect.arrayContaining(channels));
		await kernel.root.fiber.dispose();
		await settle();
		for (const channel of channels) expect(kernel.host.handlers.has(channel)).toBe(false);
	});

	it('lists the providers of the agent host', async () => {
		const kernel = await boot();
		const providers = value(await call<{ id: string }[]>(kernel, 'ai:providers'));
		expect(providers.map((provider) => provider.id)).toEqual(['fake']);
	});

	it('streams a turn to the renderer and finishes with done', async () => {
		const kernel = await boot();
		kernel.host.agents.script = function* () {
			yield { type: 'thought', text: 'thinking' };
			yield { type: 'text', text: 'Hello ' };
			yield { type: 'text', text: 'world' };
		};
		const sessionId = await startSession(kernel);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'run-1', prompt: 'hi' }));
		await until(() => events(kernel).some((event) => event.type === 'done'));
		expect(events(kernel)).toEqual([
			{ type: 'thought', text: 'thinking' },
			{ type: 'text', text: 'Hello ' },
			{ type: 'text', text: 'world' },
			{ type: 'done', stopReason: 'end_turn' }
		]);
		const first = kernel.window.sent[0].payload as AiEventMessage;
		expect(first).toMatchObject({ sessionId, runId: 'run-1' });
	});

	it('round-trips a tool call through the renderer', async () => {
		const kernel = await boot();
		let answer = '';
		kernel.host.agents.script = async function* (_prompt, tools) {
			const result = await tools.call('read_tree', { depth: 1 });
			answer = result.text;
			yield { type: 'text', text: `saw ${result.text}` };
		};
		const sessionId = await startSession(kernel);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'run-7', prompt: 'look' }));
		await until(() => toolCalls(kernel).length === 1);
		const request = toolCalls(kernel)[0];
		expect(request).toMatchObject({ sessionId, runId: 'run-7', tool: 'read_tree' });
		expect(request.input).toEqual({ depth: 1 });
		value(await call(kernel, 'ai:toolResult', { callId: request.callId, ok: true, text: '{}' }));
		await until(() => events(kernel).some((event) => event.type === 'done'));
		expect(answer).toBe('{}');
		expect(events(kernel)).toContainEqual({ type: 'text', text: 'saw {}' });
	});

	it('cancel stops the harness and fails the pending tool call', async () => {
		const kernel = await boot();
		let failure = '';
		kernel.host.agents.script = async function* (_prompt, tools) {
			const result = await tools.call('read_tree', {});
			failure = result.text;
			yield { type: 'text', text: 'never shown' };
		};
		const sessionId = await startSession(kernel);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'run-1', prompt: 'go' }));
		await until(() => toolCalls(kernel).length === 1);
		value(await call(kernel, 'ai:cancel', { sessionId }));
		await until(() => events(kernel).some((event) => event.type === 'done'));
		expect(kernel.host.agents.sessions[0].cancelCount).toBe(1);
		expect(events(kernel)).toEqual([{ type: 'done', stopReason: 'cancelled' }]);
		expect(failure).toContain('cancelled');
	});

	it('reports a failing turn as error then done, and allows the next turn', async () => {
		const kernel = await boot();
		let turn = 0;
		const script: AgentScript = function* () {
			turn += 1;
			if (turn === 1) throw new Error('rate limited');
			yield { type: 'text', text: 'back' };
		};
		kernel.host.agents.script = script;
		const sessionId = await startSession(kernel);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'a', prompt: 'one' }));
		await until(() => events(kernel).some((event) => event.type === 'done'));
		expect(events(kernel)).toEqual([
			{ type: 'error', message: 'rate limited' },
			{ type: 'done', stopReason: 'error' }
		]);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'b', prompt: 'two' }));
		await until(() => events(kernel).filter((event) => event.type === 'done').length === 2);
		expect(events(kernel)).toContainEqual({ type: 'text', text: 'back' });
	});

	it('rejects a second turn while one runs and an unknown session', async () => {
		const kernel = await boot();
		kernel.host.agents.script = async function* (_prompt, tools) {
			await tools.call('read_tree', {});
			yield { type: 'text', text: 'late' };
		};
		const sessionId = await startSession(kernel);
		value(await call(kernel, 'ai:send', { sessionId, runId: 'a', prompt: 'one' }));
		const busy = await call(kernel, 'ai:send', { sessionId, runId: 'b', prompt: 'two' });
		expect(busy).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining('already') }
		});
		const unknown = await call(kernel, 'ai:send', { sessionId: 'nope', runId: 'c', prompt: 'x' });
		expect(unknown).toMatchObject({ ok: false });
		value(await call(kernel, 'ai:cancel', { sessionId }));
	});

	it('refuses a session of another window', async () => {
		const kernel = await boot();
		const sessionId = await startSession(kernel);
		const other = kernel.host.createWindow({
			width: 100,
			height: 100,
			minWidth: 1,
			minHeight: 1,
			frame: false,
			backgroundColor: '#000',
			preloadPath: '/x'
		});
		const answer = await kernel.host.invoke(
			'ai:send',
			{ sessionId, runId: 'a', prompt: 'x' },
			kernel.host.trustedEvent(other)
		);
		expect(answer).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } });
	});

	it('validates payloads', async () => {
		const kernel = await boot();
		const answer = await call(kernel, 'ai:send', { sessionId: 's', prompt: '' });
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});

	it('hands provider credentials from settings to the harness and never to the renderer', async () => {
		const settings = {
			core: {},
			plugins: { 'main-ai': { providerEnv: { fake: { ANTHROPIC_API_KEY: 'sk-secret' } } } }
		};
		const kernel = await boot({ [SETTINGS_FILE]: JSON.stringify(settings) });
		await startSession(kernel);
		expect(kernel.host.agents.sessions[0].init.env).toEqual({ ANTHROPIC_API_KEY: 'sk-secret' });
		const providers = value(await call(kernel, 'ai:providers'));
		expect(JSON.stringify(providers)).not.toContain('sk-secret');
		expect(JSON.stringify(kernel.window.sent)).not.toContain('sk-secret');
	});

	it('ends the session on ai:end and when the plugin is disposed', async () => {
		const kernel = await boot();
		const first = await startSession(kernel);
		await startSession(kernel);
		expect(kernel.host.agents.liveSessions()).toBe(2);
		value(await call(kernel, 'ai:end', { sessionId: first }));
		await settle();
		expect(kernel.host.agents.liveSessions()).toBe(1);
		await kernel.root.fiber.dispose();
		await settle();
		expect(kernel.host.agents.liveSessions()).toBe(0);
	});

	it('ends a session when its window closes', async () => {
		const kernel = await boot();
		await startSession(kernel);
		kernel.window.close();
		await settle();
		expect(kernel.host.agents.liveSessions()).toBe(0);
	});
});
