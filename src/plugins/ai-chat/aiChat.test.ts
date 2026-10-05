import { Context, type Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiImage, AiProviderInfo } from '../../../electron/bridge';
import { chatRowsOf, formatToolText, toolInputView } from '../../lib/ai/chatRows';
import { renderMarkdown } from '../../lib/ai/markdown';
import { FakeAiMain, type FakeScript } from '../../lib/ai/fakeMain';
import { fakeHtmlLayout, rectanglesHtml, writeHtml } from '../../lib/ai/fixtures/aiFixture';
import {
	AiConsentRequiredError,
	appendAiEvent,
	type AiRunRecord,
	type AiEvent
} from '../../lib/ai/types';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import { AiChatService, type AiChatAi } from '../../lib/services/aiChat';
import { AiChatState } from '../../lib/services/aiChatState.svelte';
import ai from '../ai';
import aiContext from '../ai-context';
import aiHistory from '../ai-history';
import aiTools from '../ai-tools';
import corePanels from '../core-panels';
import desktopBridge from '../desktop-bridge';
import variablesCore from '../variables-core';
import aiChat from './index';
import PanelHost from './PanelHost.svelte';

const fakeHeadlessRenderer: Plugin = {
	name: 'headless-renderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', { exportNode: () => Promise.reject(new Error('unused')) });
	}
};

function providers(): Plugin[] {
	return [
		...editingProviders(),
		corePanels,
		desktopBridge,
		variablesCore,
		fakeHeadlessRenderer,
		fakeOverlay,
		fakeHtmlLayout,
		ai,
		aiTools,
		aiContext,
		aiHistory
	];
}

describePlugin('ai-chat', aiChat, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		const tab = ctx.panels.getTab('ai-chat');
		expect(tab).toMatchObject({ side: 'left', title: 'AI' });
		expect(ctx.commands.has('ai-chat.open')).toBe(true);
		expect(ctx.aiChat.conversation()).toEqual([]);
	}
});

// ---------- the service against a fake `ai` ----------

class FakeAi implements AiChatAi {
	available = true;
	providers: readonly AiProviderInfo[] = [];
	providerId = 'fake';
	modelId = '';
	effortId = '';
	consent = true;
	records: AiRunRecord[] = [];
	cancelled: string[] = [];
	prompts: { prompt: string; attachments: number; images: number }[] = [];

	get activeRun(): AiRunRecord | undefined {
		return this.records.find((record) => record.status === 'running');
	}
	runs(): readonly AiRunRecord[] {
		return this.records;
	}
	hasConsent(): boolean {
		return this.consent;
	}
	grantConsent(): void {
		this.consent = true;
	}
	run(
		prompt: string,
		options: { attachments?: { text: string }[]; images?: AiImage[] } = {}
	): { id: string } {
		if (!this.consent) throw new AiConsentRequiredError('doc');
		const id = `r${this.records.length + 1}`;
		const images = options.images ?? [];
		this.prompts.push({
			prompt,
			attachments: options.attachments?.length ?? 0,
			images: images.length
		});
		this.records.push({
			id,
			label: prompt,
			prompt,
			origin: 'ai',
			scope: 'write',
			provider: 'fake',
			model: null,
			effort: null,
			images,
			documentId: 'doc',
			startedAt: 0,
			status: 'running',
			events: [],
			toolResults: [],
			endedAt: null,
			error: null
		});
		return { id };
	}
	cancel(runId: string): Promise<void> {
		this.cancelled.push(runId);
		this.records = this.records.map((record) =>
			record.id === runId ? { ...record, status: 'cancelled' } : record
		);
		return Promise.resolve();
	}
	selectModel(providerId: string, modelId: string): void {
		this.providerId = providerId;
		this.modelId = modelId;
	}
	selectEffort(effort: string): void {
		this.effortId = effort;
	}
	refreshProviders(): Promise<readonly AiProviderInfo[]> {
		return Promise.resolve(this.providers);
	}
}

function provider(overrides: Partial<AiProviderInfo>): AiProviderInfo {
	return {
		id: 'fake',
		label: 'Scripted',
		available: true,
		models: [{ id: 'm1', name: 'Model one', description: 'Fast' }],
		images: true,
		efforts: ['low', 'xhigh'],
		...overrides
	};
}

function chatWith(fake: FakeAi, selected: string[] = []): AiChatService {
	return new AiChatService(
		new Context(),
		fake,
		{
			stateOf: () => 'applied',
			canRevert: () => false,
			revertRun: () => {},
			revertLastRun: () => false
		},
		{ documentId: 'doc' },
		{
			selectionAttachment: () => {
				if (selected.length === 0) return undefined;
				return {
					kind: 'selection',
					label: `Selection (${selected.length})`,
					text: selected.join()
				};
			}
		},
		new AiChatState()
	);
}

describe('chat service with a fake ai service', () => {
	it('sends the draft, clears it and refuses an empty draft or a second run', () => {
		const fake = new FakeAi();
		const chat = chatWith(fake);
		expect(chat.send()).toBe(false);
		chat.setDraft('  Make it round  ');
		expect(chat.canSend).toBe(true);
		expect(chat.send()).toBe(true);
		expect(fake.prompts).toEqual([{ prompt: 'Make it round', attachments: 0, images: 0 }]);
		expect(chat.draft).toBe('');
		expect(chat.running).toBe(true);
		chat.setDraft('Another');
		expect(chat.canSend).toBe(false);
		expect(chat.send()).toBe(false);
	});

	it('stops the running run', async () => {
		const fake = new FakeAi();
		const chat = chatWith(fake);
		chat.setDraft('Go');
		chat.send();
		await chat.stop();
		expect(fake.cancelled).toEqual(['r1']);
		expect(chat.running).toBe(false);
	});

	it('retries a stopped run with the same prompt, but not while another runs', async () => {
		const fake = new FakeAi();
		const chat = chatWith(fake);
		chat.setDraft('Again please');
		chat.send();
		await chat.stop();
		expect(chat.retry('r1')).toBe(true);
		expect(fake.prompts.map((entry) => entry.prompt)).toEqual(['Again please', 'Again please']);
		expect(chat.retry('r1')).toBe(false);
		expect(chat.retry('missing')).toBe(false);
	});

	it('holds the prompt back without consent and sends it after the user allows', () => {
		const fake = new FakeAi();
		fake.consent = false;
		const chat = chatWith(fake);
		chat.setDraft('Hello');
		expect(chat.send()).toBe(false);
		expect(chat.awaitingConsent).toBe(true);
		expect(chat.draft).toBe('Hello');
		chat.allowAndSend();
		expect(chat.awaitingConsent).toBe(false);
		expect(fake.prompts).toHaveLength(1);
		expect(chat.draft).toBe('');
	});

	it('attaches the selection only when asked and there is one', () => {
		const fake = new FakeAi();
		const chat = chatWith(fake, ['a', 'b']);
		chat.setDraft('One');
		chat.send();
		expect(fake.prompts[0].attachments).toBe(0);
		fake.records = [];
		chat.setAttachSelection(true);
		chat.setDraft('Two');
		chat.send();
		expect(fake.prompts[1].attachments).toBe(1);
	});

	it('sends pasted images with the prompt, or alone, and retries with them', async () => {
		const fake = new FakeAi();
		const chat = chatWith(fake);
		const image = { mimeType: 'image/png', data: 'iVBORw0KGgo=' };
		chat.addImage(image);
		chat.setDraft('What is this?');
		chat.send();
		expect(fake.prompts[0]).toMatchObject({ prompt: 'What is this?', images: 1 });
		expect(chat.images).toEqual([]);
		await chat.stop();
		chat.addImage(image);
		chat.addImage(image);
		chat.removeImage(0);
		expect(chat.canSend).toBe(true);
		chat.send();
		expect(fake.prompts[1]).toMatchObject({ prompt: 'Look at the attached image.', images: 1 });
		await chat.stop();
		chat.retry('r1');
		expect(fake.prompts[2].images).toBe(1);
	});

	it('drops pasted images for a provider without image input', () => {
		const fake = new FakeAi();
		fake.providers = [provider({ images: false })];
		const chat = chatWith(fake);
		chat.addImage({ mimeType: 'image/png', data: 'iVBORw0KGgo=' });
		chat.setDraft('Hi');
		chat.send();
		expect(chat.acceptsImages).toBe(false);
		expect(fake.prompts[0].images).toBe(0);
	});

	it('offers available harnesses, their models and efforts', () => {
		const fake = new FakeAi();
		fake.providers = [
			provider({}),
			provider({ id: 'codex', label: 'Codex', available: false, efforts: [] })
		];
		const chat = chatWith(fake);
		expect(chat.providerOptions()).toEqual([{ value: 'fake', label: 'Scripted' }]);
		expect(chat.modelOptions()).toEqual([{ value: 'm1', label: 'Model one', description: 'Fast' }]);
		expect(chat.effortOptions()).toEqual([
			{ value: 'low', label: 'Low' },
			{ value: 'xhigh', label: 'Extra high' }
		]);
		chat.setEffort('xhigh');
		expect(chat.effortId).toBe('xhigh');
		chat.setProvider('codex');
		expect(chat.providerId).toBe('codex');
		expect(chat.effortOptions()).toEqual([]);
	});

	it('does not send in a plain browser', () => {
		const fake = new FakeAi();
		fake.available = false;
		const chat = chatWith(fake);
		chat.setDraft('Hi');
		expect(chat.send()).toBe(false);
	});

	it('toggles rows open and closed', () => {
		const chat = chatWith(new FakeAi());
		chat.toggleRow('r1:0');
		expect(chat.isExpanded('r1:0')).toBe(true);
		chat.toggleRow('r1:0');
		expect(chat.isExpanded('r1:0')).toBe(false);
	});
});

describe('chat rows', () => {
	it('turns recorded events into messages, reasoning, tool rows and edits', () => {
		let events: AiEvent[] = [];
		const add = (event: AiEvent): void => {
			events = appendAiEvent(events, event);
		};
		add({ type: 'thought', text: 'Looking' });
		add({
			type: 'tool_call',
			callId: 'c1',
			name: 'edit',
			input: { ops: [1, 2] },
			status: 'running'
		});
		add({ type: 'tool_call', callId: 'c1', name: 'edit', status: 'done' });
		add({ type: 'edit', edit: { label: 'Cards', nodeIds: ['a', 'b'], changeCount: 2 } });
		add({ type: 'text', text: 'Done' });
		add({ type: 'error', message: 'oops' });
		const rows = chatRowsOf({
			id: 'r',
			events,
			label: '',
			prompt: '',
			origin: 'ai',
			scope: 'write',
			provider: '',
			model: null,
			effort: null,
			images: [],
			documentId: '',
			startedAt: 0,
			status: 'done',
			toolResults: [],
			endedAt: null,
			error: null
		});
		expect(rows.map((row) => row.kind)).toEqual(['thought', 'tool', 'edit', 'text', 'error']);
		expect(rows[1]).toMatchObject({
			name: 'edit',
			status: 'done',
			summary: '2 operations',
			output: null
		});
		expect(rows[2]).toMatchObject({ nodeCount: 2, changeCount: 2 });
	});

	it('pairs each call with the answer of the same tool, in order, and shows pictures', () => {
		let events: AiEvent[] = [];
		const add = (event: AiEvent): void => {
			events = appendAiEvent(events, event);
		};
		add({ type: 'tool_call', callId: 'h1', name: 'read', status: 'done' });
		add({ type: 'tool_call', callId: 'h2', name: 'screenshot', status: 'done' });
		add({ type: 'tool_call', callId: 'h3', name: 'read', status: 'failed' });
		const picture = JSON.stringify({ width: 2, height: 1, mimeType: 'image/png', base64: 'AA==' });
		const rows = chatRowsOf({
			id: 'r',
			events,
			label: '',
			prompt: '',
			origin: 'ai',
			scope: 'write',
			provider: '',
			model: null,
			effort: null,
			images: [],
			documentId: '',
			startedAt: 0,
			status: 'done',
			toolResults: [
				{ tool: 'read', input: { ids: ['card'] }, ok: true, text: '<div data-id="card"></div>' },
				{ tool: 'screenshot', input: {}, ok: true, text: picture },
				{ tool: 'read', input: { find: 'Buy' }, ok: false, text: 'no layer' }
			],
			endedAt: null,
			error: null
		});
		expect(rows[0]).toMatchObject({ summary: 'card', output: { ok: true, image: null } });
		expect(rows[1]).toMatchObject({
			summary: 'selection',
			output: { text: '2 × 1 image', image: { src: 'data:image/png;base64,AA==' } }
		});
		expect(rows[2]).toMatchObject({
			summary: 'find "Buy"',
			output: { ok: false, text: 'no layer' }
		});
	});

	it('splits long input strings from the other fields', () => {
		const view = toolInputView({ html: `<div>${'x'.repeat(100)}</div>`, replace: 'card' });
		expect(view.blocks.map((block) => block.key)).toEqual(['html']);
		expect(view.rest).toContain('"replace": "card"');
		expect(formatToolText('{"a":1}')).toBe('{\n  "a": 1\n}');
		expect(formatToolText('<p>plain</p>')).toBe('<p>plain</p>');
	});
});

describe('markdown', () => {
	it('renders formatting and drops scripts, handlers and unsafe links', () => {
		const html = renderMarkdown(
			'**Bold** and `code`\n\n- one\n- two\n\n<img src=x onerror="alert(1)"><script>alert(1)</script>[bad](javascript:alert(1)) [ok](https://example.com)'
		);
		expect(html).toContain('<strong>Bold</strong>');
		expect(html).toContain('<code>code</code>');
		expect(html).toContain('<li>one</li>');
		expect(html).not.toMatch(/<(script|img)/);
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('href="javascript:');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('target="_blank"');
	});
});

// ---------- the whole loop and the panel ----------

let mounted: MountedPlugin | undefined;
let host: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function setup(script: FakeScript): Promise<{ ctx: Context; main: FakeAiMain }> {
	let push: (channel: never, payload: never) => void = () => {};
	const main = new FakeAiMain((channel, payload) => push(channel as never, payload as never));
	main.script = script;
	mounted = await mountPlugin(aiChat, { providers: providers(), desktop: { ai: main.section } });
	const desktop = mounted.desktop;
	if (!desktop) throw new Error('no fake desktop');
	push = desktop.emit as typeof push;
	return { ctx: mounted.ctx, main };
}

describe('chat against the real ai stack', () => {
	it('asks for consent, then streams a run, shows its edit and undoes it', async () => {
		const { ctx } = await setup(async (turn) => {
			turn.send({ type: 'thought', text: 'Planning' });
			await writeHtml(turn, rectanglesHtml(3));
			turn.send({ type: 'text', text: 'Added three cards.' });
		});
		const chat = ctx.aiChat;
		expect(chat.needsConsent).toBe(true);
		chat.setDraft('Add cards');
		expect(chat.send()).toBe(false);
		expect(chat.awaitingConsent).toBe(true);
		chat.allowAndSend();
		await vi.waitFor(() => expect(chat.conversation().at(-1)?.status).toBe('done'));
		const record = chat.conversation().at(-1);
		if (!record) throw new Error('no run');
		expect(chatRowsOf(record).map((row) => row.kind)).toEqual(['thought', 'edit', 'text']);
		expect(ctx.document.query((node) => node.name.startsWith('Card ')).length).toBe(3);
		expect(chat.revertibleRunId).toBe(record.id);
		chat.undoRun(record.id);
		expect(ctx.document.query((node) => node.name.startsWith('Card ')).length).toBe(0);
		expect(chat.revertibleRunId).toBeNull();
		expect(chat.historyStateOf(record.id)).toBe('undone');
	});

	it('stops a running turn and retries it', async () => {
		let turns = 0;
		let release: () => void = () => {};
		const { ctx, main } = await setup(async (turn) => {
			turns += 1;
			if (turns > 1) {
				turn.send({ type: 'text', text: 'second time' });
				return;
			}
			await vi.waitFor(() => expect(turn.cancelled()).toBe(true));
			release();
		});
		ctx.ai.grantConsent(ctx.document.documentId);
		const chat = ctx.aiChat;
		chat.setDraft('Long task');
		chat.send();
		await vi.waitFor(() => expect(main.sent).toHaveLength(1));
		await chat.stop();
		await vi.waitFor(() => expect(chat.running).toBe(false));
		expect(chat.conversation().at(-1)?.status).toBe('cancelled');
		expect(chat.retry(chat.conversation()[0].id)).toBe(true);
		await vi.waitFor(() => expect(chat.conversation().at(-1)?.status).toBe('done'));
		expect(chat.conversation()).toHaveLength(2);
		release();
	});

	it('renders the conversation, the stop button while it runs and the composer', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { ctx } = await setup(async (turn) => {
			turn.send({ type: 'thought', text: 'Hmm' });
			turn.send({ type: 'text', text: 'Working on it' });
			await gate;
		});
		ctx.ai.grantConsent(ctx.document.documentId);
		target = document.createElement('div');
		document.body.append(target);
		host = mount(PanelHost, { target, props: { ctx } });
		flushSync();
		expect(target.querySelector('[data-ai-empty]')).not.toBeNull();
		expect(target.querySelector('textarea')?.getAttribute('placeholder')).toBe('Ask for changes');
		expect(target.querySelector('[aria-label="Send"]')).not.toBeNull();

		ctx.aiChat.setDraft('Do the thing');
		ctx.aiChat.send();
		await vi.waitFor(() => {
			flushSync();
			expect(target?.querySelector('[aria-label="Stop"]')).not.toBeNull();
			expect(target?.textContent).toContain('Working on it');
		});
		expect(target.querySelector('[data-ai-user-message]')?.textContent?.trim()).toBe(
			'Do the thing'
		);
		expect(target.textContent).toContain('Reasoning');
		release();
		await vi.waitFor(() => {
			flushSync();
			expect(target?.querySelector('[aria-label="Send"]')).not.toBeNull();
		});
	});
});
