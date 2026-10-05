import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeAiMain, type FakeScript } from '../../lib/ai/fakeMain';
import {
	AiConsentRequiredError,
	type AiEvent,
	type AiRunInfo,
	type AiToolHandler
} from '../../lib/ai/types';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { documentWith, sampleDocument } from '../../lib/services/fixtures/documentFixture';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import desktopBridge from '../desktop-bridge';
import ai from './index';

const providers = [coreContextKeys, coreCommands, desktopBridge, documentWith(sampleDocument())];

interface Setup {
	mounted: MountedPlugin;
	main: FakeAiMain;
}

let current: Setup | undefined;

afterEach(async () => {
	await current?.mounted.cleanup();
	current = undefined;
});

async function setup(
	script: FakeScript = () => Promise.resolve(),
	config: { requireConsent: boolean } = { requireConsent: false }
): Promise<Setup> {
	let push: (channel: never, payload: never) => void = () => {};
	const main = new FakeAiMain((channel, payload) => push(channel as never, payload as never));
	main.script = script;
	const mounted = await mountPlugin(ai, {
		providers,
		desktop: { ai: main.section },
		config
	});
	const desktop = mounted.desktop;
	if (!desktop) throw new Error('no fake desktop');
	push = desktop.emit as typeof push;
	current = { mounted, main };
	return current;
}

async function collect(run: AsyncIterable<AiEvent>): Promise<AiEvent[]> {
	const events: AiEvent[] = [];
	for await (const event of run) events.push(event);
	return events;
}

function tool(overrides: Partial<AiToolHandler> = {}): AiToolHandler {
	return {
		id: 'echo',
		description: 'Echo the input',
		write: false,
		inputSchema: { type: 'object' },
		run: (input) => JSON.stringify(input),
		...overrides
	};
}

describePlugin('ai', ai, {
	providers,
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.ai.available).toBe(true);
		expect(ctx.commands.has('ai.cancel-run')).toBe(true);
	}
});

describe('ai service', () => {
	it('streams a run as events and records it', async () => {
		const { mounted, main } = await setup(async (turn) => {
			turn.send({ type: 'thought', text: 'hm' });
			turn.send({ type: 'text', text: 'Hello ' });
			turn.send({ type: 'text', text: 'there' });
			await Promise.resolve();
		});
		const run = mounted.ctx.ai.run('Say hello');
		expect(run.info.origin).toBe('ai');
		expect(mounted.ctx.ai.getRun(run.id)?.status).toBe('running');
		const events = await collect(run);
		expect(events.map((event) => event.type)).toEqual(['thought', 'text', 'text', 'done']);
		expect(await run.finished).toBe('done');
		const record = mounted.ctx.ai.getRun(run.id);
		expect(record?.status).toBe('done');
		expect(record?.events).toEqual([
			{ type: 'thought', text: 'hm' },
			{ type: 'text', text: 'Hello there' },
			{ type: 'done', stopReason: 'end_turn' }
		]);
		expect(main.sent[0].prompt).toBe('Say hello');
		expect(main.started[0].provider).toBe('fake');
	});

	it('emits ai/run-start and ai/run-end with the run info', async () => {
		const { mounted } = await setup();
		const seen: string[] = [];
		mounted.ctx.on('ai/run-start', (info: AiRunInfo) => void seen.push(`start ${info.label}`));
		mounted.ctx.on('ai/run-end', (info: AiRunInfo, status) => void seen.push(`end ${status}`));
		const run = mounted.ctx.ai.run('Tidy up the page');
		await run.finished;
		expect(seen).toEqual(['start Tidy up the page', 'end done']);
	});

	it('needs the document consent before the first run', async () => {
		const { mounted } = await setup(() => Promise.resolve(), { requireConsent: true });
		try {
			const documentId = mounted.ctx.document.documentId;
			expect(mounted.ctx.ai.hasConsent(documentId)).toBe(false);
			expect(() => mounted.ctx.ai.run('hi')).toThrow(AiConsentRequiredError);
			mounted.ctx.ai.grantConsent(documentId);
			const run = mounted.ctx.ai.run('hi');
			await run.finished;
			mounted.ctx.ai.revokeConsent(documentId);
			expect(() => mounted.ctx.ai.run('again')).toThrow(AiConsentRequiredError);
		} finally {
			await mounted.cleanup();
		}
	});

	it('answers tool calls from main with the registered handler', async () => {
		let answer = '';
		const { mounted, main } = await setup(async (turn) => {
			const result = await turn.callTool('echo', { value: 3 });
			answer = result.text;
		});
		const seenRuns: string[] = [];
		const dispose = mounted.ctx.ai.registerTool(
			tool({
				run: (input, run) => {
					seenRuns.push(run.id);
					return JSON.stringify(input);
				}
			})
		);
		const run = mounted.ctx.ai.run('call it');
		await run.finished;
		expect(answer).toBe('{"value":3}');
		expect(seenRuns).toEqual([run.id]);
		expect(main.started[0].tools.map((definition) => definition.name)).toEqual(['echo']);
		dispose();
		expect(mounted.ctx.ai.tools.has('echo')).toBe(false);
	});

	it('fails a call for an unknown tool, a throwing tool and a write tool in a read-only run', async () => {
		const answers: { ok: boolean; text: string }[] = [];
		const { mounted } = await setup(async (turn) => {
			answers.push(await turn.callTool('missing', {}));
			answers.push(await turn.callTool('boom', {}));
			answers.push(await turn.callTool('writer', {}));
		});
		mounted.ctx.ai.registerTool(
			tool({
				id: 'boom',
				run: () => {
					throw new Error('node n99 does not exist');
				}
			})
		);
		mounted.ctx.ai.registerTool(tool({ id: 'writer', write: true }));
		const run = mounted.ctx.ai.run('try them', { scope: 'read' });
		await run.finished;
		expect(answers[0]).toMatchObject({ ok: false, text: expect.stringContaining('unknown tool') });
		expect(answers[1]).toEqual({ ok: false, text: 'node n99 does not exist' });
		expect(answers[2]).toMatchObject({ ok: false, text: expect.stringContaining('read-only') });
	});

	it('hides write tools from a read-only session', async () => {
		const { mounted, main } = await setup();
		mounted.ctx.ai.registerTool(tool({ id: 'reader' }));
		mounted.ctx.ai.registerTool(tool({ id: 'writer', write: true }));
		await mounted.ctx.ai.run('look', { scope: 'read' }).finished;
		expect(main.started[0].tools.map((definition) => definition.name)).toEqual(['reader']);
	});

	it('offers and accepts only the tools a run is limited to', async () => {
		let answer = { ok: true, text: '' };
		const { mounted, main } = await setup(async (turn) => {
			answer = await turn.callTool('writer', {});
		});
		mounted.ctx.ai.registerTool(tool({ id: 'reader' }));
		mounted.ctx.ai.registerTool(tool({ id: 'writer', write: true }));
		await mounted.ctx.ai.run('only reading', { tools: ['reader'] }).finished;
		expect(main.started[0].tools.map((definition) => definition.name)).toEqual(['reader']);
		expect(answer).toMatchObject({ ok: false, text: expect.stringContaining('not available') });
	});

	it('offers a task-only tool only to runs that name it', async () => {
		const { mounted, main } = await setup();
		mounted.ctx.ai.registerTool(tool({ id: 'reader' }));
		mounted.ctx.ai.registerTool(tool({ id: 'task', taskOnly: true }));
		await mounted.ctx.ai.run('anything').finished;
		expect(main.started[0].tools.map((definition) => definition.name)).toEqual(['reader']);
		await mounted.ctx.ai.run('the task', { tools: ['reader', 'task'] }).finished;
		expect(main.started).toHaveLength(2);
		expect(main.started[1].tools.map((definition) => definition.name)).toEqual(['reader', 'task']);
	});

	it('registers skills with string and function bodies; disposing removes them', async () => {
		const { mounted } = await setup();
		let count = 1;
		const disposeLayout = mounted.ctx.ai.registerSkill({
			id: 'layout',
			summary: 'how auto layout maps to flexbox',
			body: '# Layout'
		});
		const disposeLive = mounted.ctx.ai.registerSkill({
			id: 'live',
			summary: 'reads live state',
			body: () => `count ${count}`
		});
		expect(mounted.ctx.ai.skillText('layout')).toBe('# Layout');
		expect(mounted.ctx.ai.skillText('live')).toBe('count 1');
		count = 2;
		expect(mounted.ctx.ai.skillText('live')).toBe('count 2');
		expect(mounted.ctx.ai.skillText('missing')).toBeUndefined();
		disposeLayout();
		expect(mounted.ctx.ai.skillText('layout')).toBeUndefined();
		expect(mounted.ctx.ai.skills.has('layout')).toBe(false);
		disposeLive();
		expect(mounted.ctx.ai.skills.list()).toEqual([]);
	});

	it('lists the skills in the system prompt when the skill tool is offered', async () => {
		const { mounted, main } = await setup();
		mounted.ctx.ai.registerSkill({ id: 'layout', summary: 'flexbox and auto layout', body: '' });
		await mounted.ctx.ai.run('without the tool').finished;
		expect(main.started[0].system).not.toContain('layout: flexbox and auto layout');
		mounted.ctx.ai.registerTool(tool({ id: 'skill' }));
		await mounted.ctx.ai.run('with the tool').finished;
		expect(main.started).toHaveLength(2);
		expect(main.started[1].system).toContain('Skills (load one with the skill tool');
		expect(main.started[1].system).toContain('- layout: flexbox and auto layout');
	});

	it('puts a skill tied to an offered tool into the prompt in full instead of the index', async () => {
		const { mounted, main } = await setup();
		mounted.ctx.ai.registerTool(tool({ id: 'skill' }));
		mounted.ctx.ai.registerSkill({
			id: 'html',
			summary: 'writing HTML',
			body: '# Writing HTML in full',
			inlineWith: 'write'
		});
		await mounted.ctx.ai.run('without write').finished;
		expect(main.started[0].system).toContain('- html: writing HTML');
		expect(main.started[0].system).not.toContain('# Writing HTML in full');
		mounted.ctx.ai.registerTool(tool({ id: 'write' }));
		await mounted.ctx.ai.run('with write').finished;
		expect(main.started[1].system).toContain('# Writing HTML in full');
		expect(main.started[1].system).not.toContain('- html: writing HTML');
	});

	it('cancels a run: main is told, the run ends cancelled', async () => {
		const { mounted, main } = await setup(async (turn) => {
			await vi.waitFor(() => expect(turn.cancelled()).toBe(true));
		});
		const run = mounted.ctx.ai.run('long task');
		await vi.waitFor(() => expect(main.sent).toHaveLength(1));
		await run.cancel();
		expect(main.cancels).toBe(1);
		expect(await run.finished).toBe('cancelled');
		expect(mounted.ctx.ai.getRun(run.id)?.status).toBe('cancelled');
		expect(mounted.ctx.ai.activeRun).toBeUndefined();
	});

	it('rejects tool calls that arrive after the run ended', async () => {
		let late = { ok: true, text: '' };
		const { mounted, main } = await setup(async (turn) => {
			turn.send({ type: 'text', text: 'done early' });
			await Promise.resolve();
		});
		mounted.ctx.ai.registerTool(tool());
		const run = mounted.ctx.ai.run('x');
		await run.finished;
		const emitter = mounted.desktop?.emit;
		if (!emitter) throw new Error('no fake desktop');
		const answered = new Promise<{ ok: boolean; text: string }>((resolve) => {
			main.onToolResult = (result) => resolve({ ok: result.ok, text: result.text });
		});
		emitter('ai:tool-call', {
			sessionId: 's',
			runId: run.id,
			callId: 'late-1',
			tool: 'echo',
			input: {}
		});
		late = await answered;
		expect(late.ok).toBe(false);
		expect(late.text).toContain('not active');
	});

	it('turns a failing turn into an error status', async () => {
		const { mounted } = await setup(() => Promise.reject(new Error('rate limited')));
		const run = mounted.ctx.ai.run('go');
		expect(await run.finished).toBe('error');
		expect(mounted.ctx.ai.getRun(run.id)?.error).toBe('rate limited');
	});

	it('reports a missing harness as an error event', async () => {
		const { mounted, main } = await setup();
		main.providers = [];
		const run = mounted.ctx.ai.run('go');
		const events = await collect(run);
		expect(events[0]).toMatchObject({ type: 'error', message: expect.stringContaining('no AI') });
		expect(await run.finished).toBe('error');
	});

	it('keeps one session across runs and restarts it when the model changes', async () => {
		const { mounted, main } = await setup();
		await mounted.ctx.ai.run('one').finished;
		await mounted.ctx.ai.run('two').finished;
		expect(main.started).toHaveLength(1);
		mounted.ctx.ai.selectModel('fake', 'scripted-1');
		await mounted.ctx.ai.run('three').finished;
		expect(main.started).toHaveLength(2);
		expect(main.started[1].model).toBe('scripted-1');
		expect(main.ended).toEqual(['session-1']);
	});

	it('restarts the session with the chosen effort and sends images with the prompt', async () => {
		const { mounted, main } = await setup();
		await mounted.ctx.ai.refreshProviders();
		mounted.ctx.ai.selectEffort('high');
		const image = { mimeType: 'image/png', data: 'iVBORw0KGgo=' };
		await mounted.ctx.ai.run('look', { images: [image] }).finished;
		expect(main.started[0].effort).toBe('high');
		expect(main.sent[0].images).toEqual([image]);
		await mounted.ctx.ai.run('again').finished;
		expect(main.sent[1].images).toBeUndefined();
		mounted.ctx.ai.selectEffort('low');
		await mounted.ctx.ai.run('lower').finished;
		expect(main.started).toHaveLength(2);
		expect(main.started[1].effort).toBe('low');
	});

	it('forgets an effort the newly chosen provider does not offer', async () => {
		const { mounted, main } = await setup();
		main.providers = [
			main.providers[0],
			{ ...main.providers[0], id: 'other', efforts: ['medium'] }
		];
		await mounted.ctx.ai.refreshProviders();
		mounted.ctx.ai.selectEffort('high');
		mounted.ctx.ai.selectModel('other', '');
		expect(mounted.ctx.ai.effortId).toBe('');
	});

	it('reports edits of a run on the run and as an event', async () => {
		const { mounted } = await setup(async (turn) => {
			await turn.callTool('writer', {});
		});
		const edits: string[] = [];
		mounted.ctx.on('ai/edit', (_run, edit) => void edits.push(edit.label));
		mounted.ctx.ai.registerTool(
			tool({
				id: 'writer',
				write: true,
				run: (_input, run) => {
					mounted.ctx.ai.reportEdit(run.id, {
						label: 'made 2',
						nodeIds: ['a', 'b'],
						changeCount: 2
					});
					return 'ok';
				}
			})
		);
		const run = mounted.ctx.ai.run('write');
		const events = await collect(run);
		expect(events.some((event) => event.type === 'edit')).toBe(true);
		expect(edits).toEqual(['made 2']);
	});

	it('ends the session when the plugin unloads', async () => {
		const { mounted, main } = await setup();
		await mounted.ctx.ai.run('one').finished;
		await mounted.fiber.dispose();
		await vi.waitFor(() => expect(main.ended).toEqual(['session-1']));
	});
});
