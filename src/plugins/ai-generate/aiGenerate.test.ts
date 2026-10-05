import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, fakeHtmlLayout, setupAi, writeHtml } from '../../lib/ai/fixtures/aiFixture';
import { generatePrompt, placeBeside, templateById } from '../../lib/ai/generate';
import { parseRgbFunction } from '../../lib/ai/html/cssValues';
import { staticLayout } from '../../lib/ai/html/fixtures';
import type { ElementSnapshot } from '../../lib/ai/html/snapshot';
import type { HtmlLayoutRequest } from '../../lib/services/htmlLayout';
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

function inlineStyle(source: Element): Map<string, string> {
	const declarations = new Map<string, string>();
	for (const declaration of (source.getAttribute('style') ?? '').split(';')) {
		const [key, ...rest] = declaration.split(':');
		if (key.trim() !== '') declarations.set(key.trim(), rest.join(':').trim());
	}
	return declarations;
}

/** `--name` of a `var(--name)` value, or undefined for a plain value. */
function variableOf(value: string): string | undefined {
	const match = /^var\((--[a-z0-9-]+)\)$/.exec(value);
	if (match === null) return undefined;
	return match[1];
}

/** What a browser computes for `value`: the variable's value when it is a var(). */
function computedValue(value: string, request: HtmlLayoutRequest): string {
	const name = variableOf(value);
	if (name === undefined) return value;
	const resolved = request.cssVariables[name];
	if (resolved === undefined) return '';
	return resolved;
}

/** Adds the flexbox, padding and var() styles staticLayout ignores to `snapshot`. */
function addFlexAndVariables(
	snapshot: ElementSnapshot,
	source: Element,
	request: HtmlLayoutRequest,
	inFlex: boolean
): void {
	const style = inlineStyle(source);
	if (inFlex) snapshot.style.position = 'static';
	const flex = style.get('display') === 'flex';
	if (flex) {
		snapshot.style.display = 'flex';
		if (style.get('flex-direction') === 'column') snapshot.style.flexDirection = 'column';
	}
	const gap = style.get('gap');
	if (gap !== undefined) {
		const pixels = Number.parseFloat(computedValue(gap, request));
		snapshot.style.rowGap = pixels;
		snapshot.style.columnGap = pixels;
		const name = variableOf(gap);
		if (name !== undefined) {
			snapshot.variables['row-gap'] = name;
			snapshot.variables['column-gap'] = name;
		}
	}
	const padding = style.get('padding');
	if (padding !== undefined) {
		const pixels = Number.parseFloat(padding);
		snapshot.style.padding = { top: pixels, right: pixels, bottom: pixels, left: pixels };
	}
	const background = style.get('background');
	const backgroundVariable = variableOf(background ?? '');
	if (background !== undefined && backgroundVariable !== undefined) {
		snapshot.style.background = parseRgbFunction(computedValue(background, request));
		snapshot.variables['background-color'] = backgroundVariable;
	}
	const sources = Array.from(source.children);
	snapshot.children.forEach((child, position) => {
		if (child.kind !== 'element') return;
		addFlexAndVariables(child, sources[position], request, flex);
	});
}

/**
 * staticLayout plus what a browser would also report for the generated design: flexbox, gap,
 * padding and var() references, so the real converter turns them into auto layout and bindings.
 */
const flexLayout: Plugin = {
	name: 'html-layout',
	apply(ctx: Context): void {
		ctx.provide('htmlLayout', {
			measure: async (html: string, request: HtmlLayoutRequest) => {
				const snapshot = await staticLayout.measure(html, request);
				const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
				const sources = Array.from(parsed.body.children);
				snapshot.roots.forEach((root, position) => {
					addFlexAndVariables(root, sources[position], request, false);
				});
				return snapshot;
			}
		});
	}
};

function providers(): Plugin[] {
	const base = aiProviders(
		[corePanels, commandPalette, fakeViewport, aiContext, aiChat],
		fixtureDocument()
	);
	return base.map((plugin) => {
		if (plugin === fakeHtmlLayout) return flexLayout;
		return plugin;
	});
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

// What a model writes for "welcome screen" with the basic app template: a vertical flex root of
// the template size bound to the file's variables, a text, a row with a Button instance and an
// image box. Children carry the positions the flex layout gives them (padding 24, gap 12).
const screen = [
	'<div data-name="Welcome screen" style="width:390px;height:844px;display:flex;flex-direction:column;gap:var(--gap);padding:24px;background:var(--brand)">',
	'<p data-name="Title" style="left:24px;top:24px;width:342px;height:34px">Hello</p>',
	'<div data-name="Actions" style="left:24px;top:70px;width:342px;height:40px;display:flex;gap:8px">',
	'<div data-name="Primary" data-component="Button" style="width:120px;height:40px"></div>',
	'</div>',
	'<div data-name="Hero image" style="left:24px;top:122px;width:300px;height:160px;background:#ccccff"></div>',
	'</div>'
].join('');

function build(html: string): FakeScript {
	return (turn) => writeHtml(turn, html);
}

describePlugin('ai-generate', aiGenerate, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('ai-generate.open')).toBe(true);
		expect(ctx.commands.has('ai-generate.run')).toBe(true);
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

	it('asks for one write call of the template size, naming components and variables', () => {
		const template = templateById('site-wireframe');
		if (template === undefined) throw new Error('no template');
		const prompt = generatePrompt({
			description: 'pricing page',
			template,
			context: 'Page: Page',
			componentNames: ['Button'],
			variableNames: ['--brand', '--gap']
		});
		expect(prompt.split('\n')[0]).toBe('Task: generate-design');
		expect(prompt).toContain('Template: Site wireframe (1440x1024)');
		expect(prompt).toContain('Request: pricing page');
		expect(prompt).toContain('ONE write call');
		expect(prompt).toContain('1440px');
		expect(prompt).toContain('by 1024px');
		expect(prompt).toContain('data-component="<name>"');
		expect(prompt).toMatch(/Components of this file.*: Button$/m);
		expect(prompt).toMatch(/Variables of this file.*var\(--name\).*: --brand, --gap$/m);
		expect(prompt).toContain('Page: Page');
		const bare = generatePrompt({
			description: 'x',
			template,
			context: '',
			componentNames: [],
			variableNames: []
		});
		expect(bare).not.toContain('Components of this file');
		expect(bare).not.toContain('Variables of this file');
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
			itemSpacing: 12,
			paddingTop: 24,
			width: 390,
			height: 844
		});
		expect(result.outcome).toMatchObject({ name: 'Welcome screen', x: 900, y: 0 });
		expect(result.outcome?.created).toBeGreaterThanOrEqual(5);
		expect(root?.type === 'FRAME' ? root.transform[0][2] : -1).toBe(900);
		expect(root?.type === 'FRAME' ? root.transform[1][2] : -1).toBe(0);
		const kids = ctx.document.children(rootId).map((id) => ctx.document.get(id));
		expect(kids.map((kid) => kid?.name)).toEqual(['Title', 'Actions', 'Hero image']);
		expect(kids[0]).toMatchObject({ type: 'TEXT' });
		expect(kids[1]).toMatchObject({ type: 'FRAME', layoutMode: 'HORIZONTAL', itemSpacing: 8 });
		expect(ctx.history.entries).toHaveLength(steps + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({
			origin: 'ai',
			label: 'Generate: welcome screen'
		});
		expect(ctx.selection.ids).toEqual([rootId]);
		expect(zoomToSelection).toHaveBeenCalled();
		expect(ctx.aiGenerate.notice).toBe(
			`Generated "Welcome screen" (${String(result.outcome?.created)} layers).`
		);
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
			name: 'Primary',
			mainComponentId: 'button'
		});
		const root = ctx.document.get(rootId);
		expect(root?.boundVariables).toMatchObject({ itemSpacing: { id: 'v2' } });
		expect(ctx.variables.resolve(rootId, 'itemSpacing')).toBe(12);
		const fill = root?.type === 'FRAME' ? root.fills[0] : undefined;
		expect(fill?.boundVariables).toMatchObject({ color: { id: 'v1' } });
	});

	it('changes nothing when the write fails, and says it did not build', async () => {
		let answer = { ok: true, text: '' };
		const ctx = await setup(async (turn) => {
			answer = await turn.callTool('write', { html: '<!-- nothing to draw -->' });
		});
		const before = structuredClone(ctx.document.snapshot);
		const result = await ctx.aiGenerate.generate('welcome screen');
		expect(result.status).toBe('done');
		expect(result.outcome).toBeUndefined();
		expect(answer.ok).toBe(false);
		expect(answer.text).toContain('no visible element');
		expect(ctx.document.snapshot).toEqual(before);
		expect(ctx.aiGenerate.notice).toContain('did not build');
		expect(ctx.selection.ids).toEqual([]);
	});

	it('takes the first write of a generate run as the design and ignores other runs', async () => {
		let second = { ok: false, text: '' };
		const ctx = await setup(async (turn) => {
			await writeHtml(turn, screen);
			second = await turn.callTool('write', {
				html: '<div data-name="Extra" style="width:10px;height:10px"></div>'
			});
		});
		const result = await ctx.aiGenerate.generate('welcome screen');
		expect(second.ok).toBe(true);
		expect(result.outcome?.name).toBe('Welcome screen');
		expect(ctx.document.get(result.outcome?.rootId ?? '')?.name).toBe('Welcome screen');
		ctx.aiGenerate.dismiss();
		await ctx.ai.run('Draw something').finished;
		expect(ctx.document.query((node) => node.name === 'Welcome screen')).toHaveLength(2);
		expect(ctx.aiGenerate.notice).toBe('');
		expect(ctx.aiGenerate.running).toBe(false);
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
			await writeHtml(turn, screen);
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
			await turn.callTool('write', { html: screen });
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
		expect(run.prompt).toContain('--brand, --gap');
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
						effort: null,
						images: [],
						documentId: 'd',
						startedAt: 0
					}
				)
			)
		).rejects.toThrow('not available');
	});
});
