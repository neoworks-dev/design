import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, setupAi } from '../../lib/ai/fixtures/aiFixture';
import { measureSpec, placeBeside, specProblem, type NodeSpec } from '../../lib/ai/generate';
import type { DesignDocument } from '../../lib/document';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { buildDocument, frame, node, page, rectangle } from '../../lib/document/fixtures';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import aiChat from '../ai-chat';
import aiContext from '../ai-context';
import commandPalette from '../command-palette';
import corePanels from '../core-panels';
import aiGenerate from './index';

function fixtureDocument(): DesignDocument {
	const document = buildDocument([
		page(
			'Page',
			[
				frame({ id: 'one', name: 'One', transform: at(0, 40), width: 300, height: 200 }),
				frame({ id: 'two', name: 'Two', transform: at(500, 100), width: 300, height: 200 }),
				node('COMPONENT', { id: 'button', name: 'Button', key: 'k', width: 120, height: 40 }, [
					rectangle({ id: 'button-bg', name: 'Background', width: 120, height: 40 })
				])
			],
			{ id: 'p' }
		)
	]);
	document.variableCollections.c1 = {
		id: 'c1',
		name: 'Brand',
		modes: [{ modeId: 'm1', name: 'Light' }],
		defaultModeId: 'm1',
		variableIds: ['v1', 'v2']
	};
	document.variables.v1 = {
		id: 'v1',
		name: 'brand',
		collectionId: 'c1',
		resolvedType: 'COLOR',
		valuesByMode: { m1: { r: 0.4, g: 0.3, b: 0.8, a: 1 } },
		scopes: [],
		codeSyntax: {},
		description: ''
	};
	document.variables.v2 = {
		id: 'v2',
		name: 'gap',
		collectionId: 'c1',
		resolvedType: 'FLOAT',
		valuesByMode: { m1: 12 },
		scopes: [],
		codeSyntax: {},
		description: ''
	};
	return document;
}

const zoomToSelection = vi.fn();
const fakeViewport: Plugin = {
	name: 'fake-viewport',
	apply(ctx) {
		ctx.provide('viewport', { zoomToSelection });
	}
};

function providers(): Plugin[] {
	return aiProviders(
		[corePanels, commandPalette, fakeViewport, aiContext, aiChat],
		fixtureDocument()
	);
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
	zoomToSelection.mockClear();
});

async function setup(script: FakeScript = () => Promise.resolve()): Promise<Context> {
	const result = await setupAi(aiGenerate, script, { providers: providers() });
	current = result.mounted;
	return result.ctx;
}

const screen: NodeSpec = {
	type: 'FRAME',
	name: 'Welcome screen',
	props: {
		width: 390,
		height: 844,
		layoutMode: 'VERTICAL',
		itemSpacing: 16,
		padding: 24,
		fill: '#eeeeee'
	},
	fillVariable: 'brand',
	bind: { itemSpacing: 'gap' },
	children: [
		{ type: 'TEXT', name: 'Title', props: { characters: 'Hello', fontSize: 28 } },
		{
			type: 'FRAME',
			name: 'Actions',
			props: { layoutMode: 'HORIZONTAL', itemSpacing: 8 },
			children: [{ type: 'FRAME', name: 'Primary', component: 'button' }]
		},
		{ type: 'RECTANGLE', name: 'Hero image', props: { width: 300, height: 160, fill: '#ccccff' } }
	]
};

function build(spec: NodeSpec): FakeScript {
	return async (turn) => {
		const result = await turn.callTool('generate_design', { root: spec });
		if (!result.ok) throw new Error(result.text);
	};
}

describePlugin('ai-generate', aiGenerate, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.ai.tools.has('generate_design')).toBe(true);
		expect(ctx.commands.has('ai-generate.open')).toBe(true);
		expect(ctx.palette.sourceList().map((source) => source.id)).toContain('generate');
		expect(ctx.aiChat.slashHints()).toEqual(['/generate']);
	}
});

describe('pure helpers', () => {
	it('places a design to the right of everything, top aligned', () => {
		expect(placeBeside([])).toEqual({ x: 0, y: 0 });
		expect(
			placeBeside([
				{ x: 0, y: 40, width: 300, height: 200 },
				{ x: 500, y: 100, width: 300, height: 200 }
			])
		).toEqual({ x: 900, y: 40 });
	});

	it('measures and rejects specs that are too big or not a frame', () => {
		expect(measureSpec(screen)).toEqual({ nodes: 5, depth: 3 });
		expect(specProblem({ ...screen, type: 'RECTANGLE' })).toContain('FRAME');
		const wide: NodeSpec = {
			type: 'FRAME',
			children: Array.from({ length: 260 }, () => ({ type: 'RECTANGLE' }) as NodeSpec)
		};
		expect(specProblem(wide)).toContain('too many');
	});
});

describe('generate a design', () => {
	it('builds an auto layout hierarchy beside the existing frames in one undo step', async () => {
		const ctx = await setup(build(screen));
		const steps = ctx.history.entries.length;
		const result = await ctx.aiGenerate.generate('welcome screen', 'basic-app');
		expect(result.status).toBe('done');
		const rootId = result.outcome?.rootId ?? '';
		const root = ctx.document.get(rootId);
		expect(root).toMatchObject({
			name: 'Welcome screen',
			layoutMode: 'VERTICAL',
			itemSpacing: 16,
			width: 390
		});
		expect(root?.type === 'FRAME' ? root.transform[0][2] : -1).toBe(900);
		expect(root?.type === 'FRAME' ? root.transform[1][2] : -1).toBe(0);
		const kids = ctx.document.children(rootId).map((id) => ctx.document.get(id));
		expect(kids.map((kid) => kid?.name)).toEqual(['Title', 'Actions', 'Hero image']);
		expect(kids[1]).toMatchObject({ type: 'FRAME', layoutMode: 'HORIZONTAL' });
		expect(ctx.history.entries).toHaveLength(steps + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({
			origin: 'ai',
			label: 'Generate: welcome screen'
		});
		expect(ctx.selection.ids).toEqual([rootId]);
		expect(zoomToSelection).toHaveBeenCalled();
		ctx.history.undo();
		expect(ctx.document.get(rootId)).toBeUndefined();
	});

	it('uses the file: component instances and variable bindings', async () => {
		const ctx = await setup(build(screen));
		const result = await ctx.aiGenerate.generate('welcome screen');
		const rootId = result.outcome?.rootId ?? '';
		const actions = ctx.document.children(rootId)[1];
		const instance = ctx.document.get(ctx.document.children(actions)[0]);
		expect(instance).toMatchObject({
			type: 'INSTANCE',
			mainComponentId: 'button',
			name: 'Primary'
		});
		const root = ctx.document.get(rootId);
		expect(root?.boundVariables).toMatchObject({ itemSpacing: { id: 'v2' } });
		expect(ctx.variables.resolve(rootId, 'itemSpacing')).toBe(12);
		const fill = root?.type === 'FRAME' ? root.fills[0] : undefined;
		expect(fill?.boundVariables).toMatchObject({ color: { id: 'v1' } });
	});

	it('changes nothing when the spec is wrong, and says what the file has', async () => {
		let answer = '';
		const ctx = await setup(async (turn) => {
			const bad = { ...screen, fillVariable: 'missing' };
			answer = (await turn.callTool('generate_design', { root: bad })).text;
		});
		const before = structuredClone(ctx.document.snapshot);
		const result = await ctx.aiGenerate.generate('welcome screen');
		expect(result.outcome).toBeUndefined();
		expect(answer).toContain('no variable "missing"');
		expect(answer).toContain('brand, gap');
		expect(ctx.document.snapshot).toEqual(before);
		expect(ctx.aiGenerate.notice).toContain('did not build');
	});

	it('refuses the tool outside a generate task and a second design in one run', async () => {
		let second = '';
		const ctx = await setup(async (turn) => {
			await turn.callTool('generate_design', { root: screen });
			second = (await turn.callTool('generate_design', { root: screen })).text;
		});
		await ctx.aiGenerate.generate('welcome screen');
		expect(second).toContain('already built');
		const before = ctx.document.revision;
		await ctx.ai.run('Draw something').finished;
		expect(ctx.document.revision).toBe(before);
	});
});

describe('cancel', () => {
	it('takes back what a stopped run already built', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let built: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			built = resolve;
		});
		const ctx = await setup(async (turn) => {
			await turn.callTool('generate_design', { root: screen });
			built();
			await gate;
		});
		const before = structuredClone(ctx.document.snapshot);
		const pending = ctx.aiGenerate.generate('welcome screen');
		await ready;
		expect(ctx.document.query((node) => node.name === 'Welcome screen')).toHaveLength(1);
		await ctx.aiGenerate.cancel();
		release();
		const result = await pending;
		expect(result.status).toBe('cancelled');
		expect(result.outcome).toBeUndefined();
		expect(ctx.document.snapshot).toEqual(before);
		expect(ctx.aiGenerate.notice).toContain('nothing was added');
		expect(ctx.aiGenerate.running).toBe(false);
	});

	it('builds nothing when the run is stopped before the tool call', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const ctx = await setup(async (turn) => {
			started();
			await gate;
			await turn.callTool('generate_design', { root: screen });
		});
		const before = structuredClone(ctx.document.snapshot);
		const pending = ctx.aiGenerate.generate('welcome screen');
		await ready;
		await ctx.aiGenerate.cancel();
		release();
		await pending;
		expect(ctx.document.snapshot).toEqual(before);
	});
});

describe('entry points', () => {
	it('/generate in the chat starts a run with the named template', async () => {
		const ctx = await setup(build(screen));
		ctx.aiChat.setDraft('/generate site-wireframe pricing page');
		expect(ctx.aiChat.send()).toBe(true);
		await expect.poll(() => ctx.ai.runs().length).toBe(1);
		const run = ctx.ai.runs()[0];
		expect(run.prompt).toContain('Template: Site wireframe (1440x1024)');
		expect(run.prompt).toContain('Request: pricing page');
		expect(run.prompt).toContain('Components of this file');
		expect(run.prompt).toContain('Variables of this file');
		await expect.poll(() => ctx.ai.runs()[0].status).toBe('done');
	});

	it('the palette tab lists the templates, disabled until something is typed', async () => {
		const ctx = await setup(build(screen));
		ctx.palette.open('generate');
		let rows = ctx.palette.rows();
		expect(rows.map((row) => row.item.title)).toEqual([
			'Basic app',
			'App wireframe',
			'Basic site',
			'Site wireframe'
		]);
		expect(rows.every((row) => row.item.enabled === false)).toBe(true);
		ctx.palette.setQuery('welcome screen');
		rows = ctx.palette.rows();
		expect(rows.every((row) => row.item.enabled === true)).toBe(true);
		await ctx.palette.runSelected();
		await expect.poll(() => ctx.document.query((n) => n.name === 'Welcome screen').length).toBe(1);
	});

	it('the agent cannot start a generation from run_command', async () => {
		const ctx = await setup();
		const handler = ctx.ai.tools.get('run_command');
		await expect(
			Promise.resolve(
				handler?.run(
					{ id: 'ai-generate.run', args: { prompt: 'x' } },
					{
						id: 'r',
						label: 'x',
						prompt: 'x',
						origin: 'ai',
						scope: 'write',
						provider: 'fake',
						model: null,
						documentId: 'd',
						startedAt: 0
					}
				)
			)
		).rejects.toThrow('not available');
	});
});
