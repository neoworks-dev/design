import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeOrigin, DesignDocument } from '../../lib/document';
import { buildDocument, frame, node, page, rectangle, text } from '../../lib/document/fixtures';
import type { AiRunInfo } from '../../lib/ai/types';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { documentWith } from '../../lib/services/fixtures/documentFixture';
import { DEFAULT_TOOL_OPTIONS, DocumentTools } from '../../lib/ai/tools/documentTools';
import ai from '../ai';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import desktopBridge from '../desktop-bridge';
import selectionPlugin from '../selection';
import variablesCore from '../variables-core';
import aiTools from './index';

const TOOL_NAMES = [
	'apply_changes',
	'create_node',
	'export_png',
	'get_node',
	'get_selection',
	'list_commands',
	'list_components',
	'list_styles',
	'list_variables',
	'query',
	'read_tree',
	'run_command',
	'set_props'
];

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

async function call(ctx: Context, name: string, input: unknown): Promise<unknown> {
	const handler = ctx.ai.tools.get(name);
	if (!handler) throw new Error(`tool ${name} is not registered`);
	return JSON.parse(await handler.run(input, run));
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
	}
});

describe('tool definitions', () => {
	it('flag exactly the writing tools and carry a JSON schema generated from the validation', async () => {
		const ctx = await mountTools();
		const writes = ctx.ai.tools
			.list()
			.filter((tool) => tool.write)
			.map((tool) => tool.id)
			.sort();
		expect(writes).toEqual(['apply_changes', 'create_node', 'run_command', 'set_props']);
		for (const tool of ctx.ai.tools.list()) {
			expect(tool.inputSchema.type).toBe('object');
			expect(tool.inputSchema.$schema).toBeUndefined();
			expect(tool.description.length).toBeGreaterThan(0);
		}
	});

	it('reject arguments of the wrong shape with a readable message', async () => {
		const ctx = await mountTools();
		expect(await failure(ctx, 'read_tree', { depth: 'deep' })).toContain('depth');
		expect(await failure(ctx, 'apply_changes', { ops: [] })).toContain('ops');
		expect(await failure(ctx, 'get_node', {})).toContain('ids');
	});
});

describe('read tools', () => {
	it('read_tree answers compact JSON of the current page', async () => {
		const ctx = await mountTools();
		const tree = (await call(ctx, 'read_tree', {})) as Record<string, unknown>;
		expect(tree).toMatchObject({ id: 'page1', type: 'PAGE', name: 'Page 1', childCount: 3 });
		const children = tree.children as Record<string, unknown>[];
		expect(children.map((child) => child.name)).toEqual(['Card', 'Loose', 'Button']);
		expect(children[0]).toMatchObject({ id: 'card', width: 300, height: 200, x: 0, y: 0 });
		const grandchildren = children[0].children as Record<string, unknown>[];
		expect(grandchildren.map((child) => child.id)).toEqual(['bg', 'title']);
	});

	it('read_tree honours depth', async () => {
		const ctx = await mountTools();
		const shallow = (await call(ctx, 'read_tree', { depth: 0 })) as Record<string, unknown>;
		expect(shallow.children).toBeUndefined();
		expect(shallow.childCount).toBe(3);
	});

	it('fails with a hint for an unknown node', async () => {
		const ctx = await mountTools();
		expect(await failure(ctx, 'read_tree', { nodeId: 'nope' })).toContain('nope');
	});

	it('get_selection reports the selected layers', async () => {
		const ctx = await mountTools();
		expect(await call(ctx, 'get_selection', {})).toMatchObject({ count: 0, nodes: [] });
		ctx.selection.select(['bg']);
		expect(await call(ctx, 'get_selection', {})).toMatchObject({
			page: { id: 'page1' },
			count: 1,
			nodes: [{ id: 'bg', name: 'Background' }]
		});
	});

	it('get_node returns details or only the asked fields', async () => {
		const ctx = await mountTools();
		expect(await call(ctx, 'get_node', { ids: ['bg'] })).toMatchObject([{ id: 'bg', width: 300 }]);
		expect(await call(ctx, 'get_node', { ids: ['bg'], fields: ['width', 'nope'] })).toEqual([
			{ id: 'bg', type: 'RECTANGLE', width: 300, unknownFields: ['nope'] }
		]);
	});

	it('query finds layers by type and name below a root', async () => {
		const ctx = await mountTools();
		const byType = (await call(ctx, 'query', { type: 'RECTANGLE' })) as { total: number };
		expect(byType.total).toBe(2);
		const byName = (await call(ctx, 'query', { name: 'back' })) as { nodes: { id: string }[] };
		expect(byName.nodes.map((entry) => entry.id)).toEqual(['bg']);
		const other = (await call(ctx, 'query', { rootId: 'page2' })) as { total: number };
		expect(other.total).toBe(1);
	});

	it('list_commands hides what the agent may not run and run_command refuses it', async () => {
		const ctx = await mountTools();
		const commands = (await call(ctx, 'list_commands', {})) as { id: string }[];
		expect(commands.map((command) => command.id)).not.toContain('ai.cancel-run');
		expect(await failure(ctx, 'run_command', { id: 'ai.cancel-run' })).toContain('not available');
		expect(await failure(ctx, 'run_command', { id: 'no.such' })).toContain('unknown command');
	});

	it('export_png returns the encoded image with its size', async () => {
		const ctx = await mountTools();
		expect(await call(ctx, 'export_png', { nodeId: 'card', scale: 2 })).toEqual({
			width: 20,
			height: 10,
			mimeType: 'image/png',
			base64: 'iVBORw=='
		});
	});

	it('export_png refuses an image over the limit', async () => {
		const ctx = await mountTools({ maxImageBytes: 2 });
		expect(await failure(ctx, 'export_png', { nodeId: 'card' })).toContain('smaller scale');
	});

	it('list_variables, list_styles and list_components read the library', async () => {
		const ctx = await mountTools();
		expect(await call(ctx, 'list_variables', {})).toMatchObject({
			collections: [{ id: 'c1', name: 'Brand' }],
			variables: [{ id: 'v1', name: 'primary', type: 'COLOR' }]
		});
		expect(await call(ctx, 'list_styles', {})).toMatchObject([{ id: 's1', name: 'Accent' }]);
		expect(await call(ctx, 'list_components', {})).toEqual([
			{
				id: 'button',
				type: 'COMPONENT',
				name: 'Button',
				page: 'Page 1',
				key: 'button-key',
				description: ''
			}
		]);
	});
});

describe('apply_changes', () => {
	function origins(ctx: Context): ChangeOrigin[] {
		const seen: ChangeOrigin[] = [];
		ctx.on('document/change', (event) => void seen.push(event.transaction.origin));
		return seen;
	}

	it('creates, sets, moves and deletes in one atomic step tagged as AI', async () => {
		const ctx = await mountTools();
		const seen = origins(ctx);
		const answer = (await call(ctx, 'apply_changes', {
			label: 'Rework card',
			ops: [
				{
					op: 'create',
					type: 'RECTANGLE',
					ref: 'badge',
					parentId: 'card',
					props: {
						name: 'Badge',
						x: 10,
						y: 20,
						width: 40,
						height: 16,
						fill: '#ff0000',
						cornerRadius: 4
					}
				},
				{ op: 'set', id: 'bg', props: { name: 'Surface', fill: '#00ff00' } },
				{ op: 'move', id: 'loose', parentId: 'card', position: 0 },
				{ op: 'delete', id: 'title' }
			]
		})) as { created: { id: string }[]; changed: string[]; deleted: string[] };
		expect(seen).toEqual(['ai']);
		expect(answer.created).toHaveLength(1);
		expect(answer.deleted).toEqual(['title']);
		const badge = ctx.document.require(answer.created[0].id);
		expect(badge).toMatchObject({ name: 'Badge', parentId: 'card', width: 40, cornerRadius: 4 });
		expect(badge.type === 'RECTANGLE' && badge.transform[0][2]).toBe(10);
		expect(badge.type === 'RECTANGLE' && badge.fills[0]).toMatchObject({
			type: 'SOLID',
			color: { r: 1, g: 0, b: 0 }
		});
		expect(ctx.document.require('bg').name).toBe('Surface');
		expect(ctx.document.get('title')).toBeUndefined();
		expect(ctx.document.require('loose').parentId).toBe('card');
	});

	it('lets a later op use the ref of an earlier create', async () => {
		const ctx = await mountTools();
		const answer = (await call(ctx, 'apply_changes', {
			ops: [
				{
					op: 'create',
					type: 'FRAME',
					ref: 'row',
					props: { name: 'Row', layoutMode: 'HORIZONTAL' }
				},
				{ op: 'create', type: 'RECTANGLE', parentId: 'row', props: { name: 'Cell' } }
			]
		})) as { created: { ref?: string; id: string }[] };
		const row = answer.created[0];
		expect(row.ref).toBe('row');
		expect(ctx.document.children(row.id)).toHaveLength(1);
	});

	it('rejects an invalid op with a readable error and changes nothing', async () => {
		const ctx = await mountTools();
		const revision = ctx.document.revision;
		const message = await failure(ctx, 'apply_changes', {
			ops: [
				{ op: 'create', type: 'RECTANGLE', props: { name: 'Fine' } },
				{ op: 'set', id: 'bg', props: { cornerRadius: -5, nonsense: 1 } }
			]
		});
		expect(message).toContain('op 2 (set)');
		expect(message).toContain('nonsense');
		expect(ctx.document.revision).toBe(revision);
		expect(ctx.document.query((candidate) => candidate.name === 'Fine')).toEqual([]);
	});

	it('explains schema violations of the document model', async () => {
		const ctx = await mountTools();
		const message = await failure(ctx, 'apply_changes', {
			ops: [{ op: 'set', id: 'title', props: { cornerRadius: 4 } }]
		});
		expect(message).toContain('op 1 (set)');
	});

	it('refuses unknown nodes, pages and bad colors', async () => {
		const ctx = await mountTools();
		expect(await failure(ctx, 'apply_changes', { ops: [{ op: 'delete', id: 'ghost' }] })).toContain(
			'ghost'
		);
		expect(await failure(ctx, 'apply_changes', { ops: [{ op: 'delete', id: 'page2' }] })).toContain(
			'page'
		);
		expect(
			await failure(ctx, 'apply_changes', {
				ops: [{ op: 'set', id: 'bg', props: { fill: 'reddish' } }]
			})
		).toContain('hex color');
	});

	it('limits the ops per call and the deletions per run', async () => {
		const ctx = await mountTools({ maxOpsPerCall: 2, maxDeletionsPerRun: 1 });
		const many = [1, 2, 3].map(() => ({ op: 'create', type: 'RECTANGLE' }));
		expect(await failure(ctx, 'apply_changes', { ops: many })).toContain('too many ops');
		await call(ctx, 'apply_changes', { ops: [{ op: 'delete', id: 'title' }] });
		expect(await failure(ctx, 'apply_changes', { ops: [{ op: 'delete', id: 'loose' }] })).toContain(
			'may delete at most 1'
		);
		expect(ctx.document.get('loose')).toBeDefined();
	});

	it('create_node and set_props are shortcuts for one op', async () => {
		const ctx = await mountTools();
		const created = (await call(ctx, 'create_node', {
			type: 'TEXT',
			props: { name: 'Label', characters: 'Hello\nWorld', fontSize: 24, x: 5, y: 6 }
		})) as { created: { id: string }[] };
		const label = ctx.document.require(created.created[0].id);
		expect(label.type).toBe('TEXT');
		if (label.type !== 'TEXT') return;
		expect(label.paragraphs.map((paragraph) => paragraph.runs[0].text)).toEqual(['Hello', 'World']);
		expect(label.defaultStyle.fontSize).toBe(24);
		await call(ctx, 'set_props', { ids: ['bg', 'loose'], props: { opacity: 0.5, rotation: 90 } });
		expect(ctx.document.require('bg')).toMatchObject({ opacity: 0.5 });
		expect(ctx.document.require('loose')).toMatchObject({ opacity: 0.5 });
	});

	it('reports the edit on the run', async () => {
		const ctx = await mountTools();
		const edits: { runId: string; nodeIds: string[]; changeCount: number }[] = [];
		const tools = new DocumentTools(
			{
				document: ctx.document,
				selection: ctx.selection,
				commands: ctx.commands,
				variables: ctx.variables,
				headlessRenderer: ctx.headlessRenderer,
				ai: {
					reportEdit: (runId, edit) => void edits.push({ runId, ...edit }),
					withRun: (_run, work) => work()
				}
			},
			DEFAULT_TOOL_OPTIONS
		);
		const setProps = tools.handlers().find((handler) => handler.id === 'set_props');
		if (!setProps) throw new Error('missing');
		await setProps.run({ ids: ['bg'], props: { name: 'Renamed' } }, run);
		expect(edits).toEqual([{ runId: 'run-1', label: 'Test run', nodeIds: ['bg'], changeCount: 1 }]);
	});
});
