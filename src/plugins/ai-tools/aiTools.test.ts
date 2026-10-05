import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeOrigin, DesignDocument } from '../../lib/document';
import { buildDocument, frame, node, page, rectangle, text } from '../../lib/document/fixtures';
import type { AiRunInfo } from '../../lib/ai/types';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { documentWith } from '../../lib/services/fixtures/documentFixture';
import { fakeHtmlLayout } from '../../lib/ai/fixtures/aiFixture';
import ai from '../ai';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import desktopBridge from '../desktop-bridge';
import selectionPlugin from '../selection';
import variablesCore from '../variables-core';
import aiTools from './index';

const TOOL_NAMES = ['edit', 'read', 'run_command', 'screenshot', 'skill', 'write'];
const SKILL_NAMES = ['commands', 'components', 'edit', 'html', 'styles', 'variables'];

function fixtureDocument(): DesignDocument {
	const document = buildDocument([
		page(
			'Page 1',
			[
				frame({ id: 'card', name: 'Card', width: 300, height: 200 }, [
					rectangle({ id: 'bg', name: 'Background', width: 300, height: 200 }),
					text({ id: 'title', name: 'Title' })
				]),
				rectangle({ id: 'loose', name: 'Loose' }),
				node('COMPONENT', { id: 'button', name: 'Button', key: 'button-key' })
			],
			{ id: 'page1' }
		),
		page('Page 2', [rectangle({ id: 'other', name: 'Other' })], { id: 'page2' })
	]);
	document.variableCollections.c1 = {
		id: 'c1',
		name: 'Brand',
		modes: [{ modeId: 'm1', name: 'Light' }],
		defaultModeId: 'm1',
		variableIds: ['v1']
	};
	document.variables.v1 = {
		id: 'v1',
		name: 'primary',
		collectionId: 'c1',
		resolvedType: 'COLOR',
		valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
		scopes: [],
		codeSyntax: {},
		description: ''
	};
	document.styles.s1 = {
		id: 's1',
		type: 'PAINT',
		name: 'Accent',
		description: '',
		value: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
	};
	return document;
}

const fakeHeadlessRenderer: Plugin = {
	name: 'headless-renderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportNode: (_id: string, options: { scale?: number }) =>
				Promise.resolve({
					bytes: new Uint8Array([137, 80, 78, 71]),
					width: 10 * (options.scale === undefined ? 1 : options.scale),
					height: 10,
					format: 'PNG',
					mimeType: 'image/png'
				})
		});
	}
};

function makeProviders(): Plugin[] {
	return [
		coreContextKeys,
		coreCommands,
		desktopBridge,
		documentWith(fixtureDocument()),
		selectionPlugin,
		variablesCore,
		fakeHeadlessRenderer,
		fakeHtmlLayout,
		ai
	];
}

const run: AiRunInfo = {
	id: 'run-1',
	label: 'Test run',
	prompt: 'Test run',
	origin: 'ai',
	scope: 'write',
	provider: 'fake',
	model: null,
	effort: null,
	images: [],
	documentId: 'fixture-document',
	startedAt: 0
};

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountTools(config?: unknown): Promise<Context> {
	mounted = await mountPlugin(aiTools, { providers: makeProviders(), desktop: true, config });
	return mounted.ctx;
}

async function answerOf(ctx: Context, name: string, input: unknown): Promise<string> {
	const handler = ctx.ai.tools.get(name);
	if (!handler) throw new Error(`tool ${name} is not registered`);
	return handler.run(input, run);
}

async function call(ctx: Context, name: string, input: unknown): Promise<unknown> {
	return JSON.parse(await answerOf(ctx, name, input));
}

async function failure(ctx: Context, name: string, input: unknown): Promise<string> {
	try {
		await call(ctx, name, input);
	} catch (error) {
		if (error instanceof Error) return error.message;
	}
	throw new Error(`${name} did not fail`);
}

describePlugin('ai-tools', aiTools, {
	providers: makeProviders(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(
			ctx.ai.tools
				.list()
				.map((tool) => tool.id)
				.sort()
		).toEqual(TOOL_NAMES);
		expect(
			ctx.ai.skills
				.list()
				.map((skill) => skill.id)
				.sort()
		).toEqual(SKILL_NAMES);
	}
});

function origins(ctx: Context): ChangeOrigin[] {
	const seen: ChangeOrigin[] = [];
	ctx.on('document/change', (event) => void seen.push(event.transaction.origin));
	return seen;
}

describe('tool definitions', () => {
	it('flag the writing tools, keep run_command for runs that ask for it, carry JSON schemas', async () => {
		const ctx = await mountTools();
		const writes = ctx.ai.tools
			.list()
			.filter((tool) => tool.write)
			.map((tool) => tool.id)
			.sort();
		expect(writes).toEqual(['edit', 'run_command', 'write']);
		const taskOnly = ctx.ai.tools.list().filter((tool) => tool.taskOnly === true);
		expect(taskOnly.map((tool) => tool.id)).toEqual(['run_command']);
		for (const tool of ctx.ai.tools.list()) {
			expect(tool.inputSchema.type).toBe('object');
			expect(tool.inputSchema.$schema).toBeUndefined();
			expect(tool.description.length).toBeGreaterThan(0);
		}
	});

	it('reject arguments of the wrong shape with a readable message', async () => {
		const ctx = await mountTools();
		expect(await failure(ctx, 'read', { depth: 'deep' })).toContain('depth');
		expect(await failure(ctx, 'write', {})).toContain('html');
	});
});

describe('read', () => {
	it('shows the page as HTML with data-ids when nothing is selected', async () => {
		const ctx = await mountTools();
		const html = await answerOf(ctx, 'read', {});
		expect(html).toContain('<!-- page "Page 1" (page1)');
		expect(html).toContain('pages: "Page 1", "Page 2"');
		expect(html).toContain('nothing selected');
		expect(html).toContain('data-id="card" data-name="Card"');
		expect(html).toContain('data-id="title"');
		expect(html).toContain('data-id="loose"');
		expect(html).not.toContain('data-id="other"');
	});

	it('reads the selection, or the layers asked for, to the asked depth', async () => {
		const ctx = await mountTools();
		ctx.selection.select(['loose'], 'replace');
		const selected = await answerOf(ctx, 'read', {});
		expect(selected).toContain('selection: loose');
		expect(selected).toContain('data-id="loose"');
		expect(selected).not.toContain('data-id="card"');
		const shallow = await answerOf(ctx, 'read', { ids: ['card'], depth: 0 });
		expect(shallow).toContain('data-children="2"');
		expect(shallow).not.toContain('data-id="bg"');
		expect(await failure(ctx, 'read', { ids: ['nope'] })).toContain('there is no layer nope');
	});

	it('finds layers by name or text', async () => {
		const ctx = await mountTools();
		const html = await answerOf(ctx, 'read', { find: 'back' });
		expect(html).toContain('1 layers match "back"');
		expect(html).toContain('data-id="bg"');
		expect(html).not.toContain('data-id="loose"');
	});

	it('writes values bound to variables as var()', async () => {
		const ctx = await mountTools();
		const fill = {
			type: 'SOLID' as const,
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL' as const,
			color: { r: 1, g: 0, b: 0 },
			boundVariables: { color: { type: 'VARIABLE_ALIAS' as const, id: 'v1' } }
		};
		ctx.document.apply(ctx.document.setProps('bg', { fills: [fill] }), {
			origin: 'user',
			label: 'Bind'
		});
		const html = await answerOf(ctx, 'read', { ids: ['bg'] });
		expect(html).toContain('background-color:var(--primary)');
	});
});

describe('write', () => {
	it('inserts HTML beside the existing work in one transaction tagged as AI', async () => {
		const ctx = await mountTools();
		const seen = origins(ctx);
		const answer = (await call(ctx, 'write', {
			label: 'Add badges',
			html: '<div data-name="Badge" style="width:40px;height:16px;background:#ff0000"></div><div data-name="Tag" style="left:60px;width:30px;height:16px"></div>'
		})) as { rootIds: string[]; created: number; removed: number };
		expect(seen).toEqual(['ai']);
		expect(answer.created).toBe(2);
		expect(answer.removed).toBe(0);
		const [badgeId, tagId] = answer.rootIds;
		const badge = ctx.document.require(badgeId);
		expect(badge).toMatchObject({ type: 'RECTANGLE', name: 'Badge', parentId: 'page1', width: 40 });
		if (badge.type !== 'RECTANGLE') return;
		expect(badge.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });
		const card = ctx.document.absoluteBounds('card');
		expect(badge.transform[0][2]).toBeGreaterThan(card.x + card.width);
		const tag = ctx.document.require(tagId);
		expect(tag.type !== 'PAGE' && tag.transform[0][2] - badge.transform[0][2]).toBe(60);
	});

	it('inserts under a parent at a position', async () => {
		const ctx = await mountTools();
		const answer = (await call(ctx, 'write', {
			html: '<div data-name="First" style="width:10px;height:10px"></div>',
			parentId: 'card',
			position: 0
		})) as { rootIds: string[] };
		expect(ctx.document.children('card')).toEqual([answer.rootIds[0], 'bg', 'title']);
	});

	it('rewrites a layer: kept data-ids stay the same layers, the rest goes', async () => {
		const ctx = await mountTools();
		ctx.document.apply(ctx.document.setProps('card', { pluginData: { keep: { me: 'yes' } } }), {
			origin: 'user',
			label: 'Plugin data'
		});
		const answer = (await call(ctx, 'write', {
			replace: 'card',
			html: '<div data-id="card" data-name="Card v2" style="width:300px;height:200px"><p data-id="title" data-name="Title" style="width:100px;height:20px">Hi</p><div data-name="New" style="top:40px;width:20px;height:20px"></div></div>'
		})) as { rootIds: string[]; created: number; removed: number };
		expect(answer.rootIds).toEqual(['card']);
		expect(answer.created).toBe(1);
		expect(answer.removed).toBe(1);
		const card = ctx.document.require('card');
		expect(card.name).toBe('Card v2');
		expect(card.pluginData).toEqual({ keep: { me: 'yes' } });
		expect(ctx.document.get('bg')).toBeUndefined();
		const children = ctx.document.children('card');
		expect(children[0]).toBe('title');
		expect(children).toHaveLength(2);
		const title = ctx.document.require('title');
		expect(title.type === 'TEXT' && title.paragraphs[0].runs[0].text).toBe('Hi');
	});

	it('refuses to replace and insert at once, unknown layers and pages', async () => {
		const ctx = await mountTools();
		const html = '<div style="width:10px;height:10px"></div>';
		expect(await failure(ctx, 'write', { html, replace: 'card', parentId: 'card' })).toContain(
			'either'
		);
		expect(await failure(ctx, 'write', { html, replace: 'nope' })).toContain(
			'there is no layer nope'
		);
		expect(await failure(ctx, 'write', { html, replace: 'page1' })).toContain('page');
	});

	it('reports the edit on the run, created roots first', async () => {
		const ctx = await mountTools();
		const edits: { nodeIds: string[]; changeCount: number }[] = [];
		ctx.on('ai/edit', () => undefined);
		const reportEdit = ctx.ai.reportEdit.bind(ctx.ai);
		ctx.ai.reportEdit = (runId, edit): void => {
			edits.push(edit);
			reportEdit(runId, edit);
		};
		const answer = (await call(ctx, 'write', {
			html: '<div data-name="One" style="width:10px;height:10px"></div>'
		})) as { rootIds: string[] };
		expect(edits).toEqual([{ label: 'Test run', nodeIds: answer.rootIds, changeCount: 1 }]);
	});
});

describe('edit', () => {
	it('renames, retexts, moves and deletes, each tagged as AI', async () => {
		const ctx = await mountTools();
		const seen = origins(ctx);
		const answer = await call(ctx, 'edit', {
			ops: [
				{ id: 'bg', name: 'Surface' },
				{ id: 'title', text: 'Hello\nWorld' },
				{ move: 'loose', parentId: 'card', position: 0 },
				{ delete: 'other' }
			]
		});
		expect(answer).toEqual([
			{ edited: 'bg' },
			{ edited: 'title' },
			{ moved: 'loose' },
			{ deleted: 'other' }
		]);
		expect(seen.every((origin) => origin === 'ai')).toBe(true);
		expect(ctx.document.require('bg').name).toBe('Surface');
		const title = ctx.document.require('title');
		expect(
			title.type === 'TEXT' && title.paragraphs.map((paragraph) => paragraph.runs[0].text)
		).toEqual(['Hello', 'World']);
		expect(ctx.document.children('card')[0]).toBe('loose');
		expect(ctx.document.get('other')).toBeUndefined();
	});

	it('sets CSS on one layer through the HTML path and keeps its id', async () => {
		const ctx = await mountTools();
		await call(ctx, 'edit', { ops: [{ id: 'loose', css: 'background: #00ff00' }] });
		const loose = ctx.document.require('loose');
		expect(loose.type === 'RECTANGLE' && loose.fills[0]).toMatchObject({
			type: 'SOLID',
			color: { r: 0, g: 1, b: 0 }
		});
	});

	it('says which op failed and what was applied before it', async () => {
		const ctx = await mountTools();
		const message = await failure(ctx, 'edit', {
			ops: [
				{ id: 'bg', name: 'Fine' },
				{ id: 'bg', text: 'nope' }
			]
		});
		expect(message).toContain('op 2');
		expect(message).toContain('not a text layer');
		expect(message).toContain('ops 1-1 were applied');
	});

	it('limits the deletions per run', async () => {
		const ctx = await mountTools({ maxDeletionsPerRun: 1 });
		await call(ctx, 'edit', { ops: [{ delete: 'other' }] });
		expect(await failure(ctx, 'edit', { ops: [{ delete: 'loose' }] })).toContain('at most 1');
		expect(ctx.document.get('loose')).toBeDefined();
	});

	it('runs app commands but refuses the blocked and unknown ones', async () => {
		const ctx = await mountTools();
		expect(await failure(ctx, 'edit', { ops: [{ command: 'ai.cancel-run' }] })).toContain(
			'not available'
		);
		expect(await failure(ctx, 'edit', { ops: [{ command: 'no.such' }] })).toContain(
			'unknown command'
		);
		expect(await failure(ctx, 'run_command', { id: 'ai.cancel-run' })).toContain('not available');
	});
});

describe('screenshot', () => {
	it('renders the layer as a PNG the model can see', async () => {
		const ctx = await mountTools();
		expect(await call(ctx, 'screenshot', { id: 'card', scale: 1 })).toEqual({
			width: 10,
			height: 10,
			mimeType: 'image/png',
			base64: 'iVBORw=='
		});
	});

	it('refuses an image over the limit', async () => {
		const ctx = await mountTools({ maxImageBytes: 2 });
		expect(await failure(ctx, 'screenshot', { id: 'card' })).toContain('smaller scale');
	});
});

describe('skills', () => {
	it('explain the HTML vocabulary and the edit operations', async () => {
		const ctx = await mountTools();
		expect(await answerOf(ctx, 'skill', { name: 'html' })).toContain('display:flex');
		expect(await answerOf(ctx, 'skill', { name: 'edit' })).toContain('"delete"');
	});

	it('read the library live: variables as custom properties, components, styles, commands', async () => {
		const ctx = await mountTools();
		expect(await answerOf(ctx, 'skill', { name: 'variables' })).toContain(
			'--primary: rgba(255, 0, 0, 1)'
		);
		expect(await answerOf(ctx, 'skill', { name: 'components' })).toContain('- Button');
		expect(await answerOf(ctx, 'skill', { name: 'styles' })).toContain('- Accent (PAINT)');
		const commands = await answerOf(ctx, 'skill', { name: 'commands' });
		expect(commands).not.toContain('ai.cancel-run');
	});

	it('name the skills there are when asked for an unknown one', async () => {
		const ctx = await mountTools();
		const message = await failure(ctx, 'skill', { name: 'nope' });
		for (const name of SKILL_NAMES) expect(message).toContain(name);
	});
});
