import { readFileSync } from 'node:fs';
import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { inlineWorkers, type InlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import {
	discovered,
	fakePluginsSection,
	listOf,
	newFakePluginState,
	pluginApiProviders,
	validManifest,
	type FakePluginState
} from '../../lib/plugins/fixtures/pluginFixture';
import { createNode, indexAtPosition, type Node } from '../../lib/document';
import { COMPAT_TABLE } from '../../lib/plugins/worker/figma/table';
import pluginApi from '../plugin-api';
import pluginStorage from '../plugin-storage';
import pluginFigmaCompat from './index';
import rectangles from './samples/rectangles.js.txt?raw';
import renameSelection from './samples/rename-selection.js.txt?raw';
import textCard from './samples/text-card.js.txt?raw';

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;
let state: FakePluginState = newFakePluginState();
let zoomed: string[][] = [];

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function wait(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mountFigma(source: string): Promise<Context> {
	workers = inlineWorkers();
	state = newFakePluginState();
	zoomed = [];
	const manifest = validManifest({
		id: 'sample',
		permissions: ['document:read', 'document:write', 'selection', 'storage'],
		contributes: { commands: [{ id: 'sample.run', title: 'Run sample' }] }
	});
	const list = listOf(discovered(manifest, { directoryName: 'sample' }));
	mounted = await mountPlugin(pluginFigmaCompat, {
		providers: [...pluginApiProviders(workers.factory, { zoomed }), pluginApi, pluginStorage],
		desktop: { plugins: fakePluginsSection(() => list, { 'user/sample/main.js': source }, state) }
	});
	await wait(20);
	return mounted.ctx;
}

/** Launch the plugin the way a user does and wait for its run to end. */
async function launch(ctx: Context): Promise<void> {
	await ctx.commands.run('sample.run');
	await wait(250);
}

type RectangleNode = Extract<Node, { type: 'RECTANGLE' }>;

function pageNodes(ctx: Context): Node[] {
	return ctx.document.childNodes(ctx.document.currentPageId);
}

function rectanglesOnPage(ctx: Context): RectangleNode[] {
	return pageNodes(ctx).filter((node): node is RectangleNode => node.type === 'RECTANGLE');
}

function addRectangle(ctx: Context, name: string): ReturnType<typeof createNode<'RECTANGLE'>> {
	const parentId = ctx.document.currentPageId;
	const position = ctx.document.children(parentId).length;
	const node = createNode('RECTANGLE', {
		name,
		parentId,
		index: indexAtPosition(ctx.document.reader, parentId, position)
	});
	ctx.document.apply(ctx.document.insertNode(node), { origin: 'user', label: `add ${name}` });
	return node;
}

function logs(ctx: Context): string[] {
	const connection = ctx.pluginHost.connectionOf('sample');
	if (connection === undefined) return [];
	return connection.logs.map((line) => line.message);
}

describePlugin('plugin-figma-compat', pluginFigmaCompat, {
	providers: [...pluginApiProviders(inlineWorkers().factory), pluginApi, pluginStorage],
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		expect(ctx.pluginHost.snapshotState().apis).toContain('figma');
		expect(ctx.pluginToasts).toBeDefined();
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'plugin-figma-compat/toasts'
		);
	}
});

describe('sample Figma plugin 1: rectangles', () => {
	it('runs unmodified, selects the rectangles and is one undo step', async () => {
		const ctx = await mountFigma(rectangles);
		const before = pageNodes(ctx).length;
		await launch(ctx);
		const created = rectanglesOnPage(ctx).slice(-5);
		expect(pageNodes(ctx)).toHaveLength(before + 5);
		expect(created.map((node) => node.transform[0][2])).toEqual([0, 150, 300, 450, 600]);
		expect(created[0].fills).toMatchObject([{ type: 'SOLID' }]);
		const paint = created[0].fills[0];
		if (paint.type !== 'SOLID') throw new Error('expected a solid fill');
		expect(paint.color.r).toBeCloseTo(1, 1);
		expect(paint.color.g).toBeCloseTo(0.5, 1);
		expect([...ctx.selection.ids]).toEqual(created.map((node) => node.id));
		expect(zoomed).toEqual([created.map((node) => node.id)]);
		expect(logs(ctx)).toEqual([]);

		expect(ctx.history.undoLabel).toBe('Example');
		expect(ctx.history.undo()).toBe(true);
		expect(pageNodes(ctx)).toHaveLength(before);
	});

	it('runs the script again when the command is launched a second time', async () => {
		const ctx = await mountFigma(rectangles);
		const before = pageNodes(ctx).length;
		await launch(ctx);
		await launch(ctx);
		expect(pageNodes(ctx)).toHaveLength(before + 10);
	});
});

describe('sample Figma plugin 2: rename selection', () => {
	it('renames the selection, stores plugin data and shows a toast', async () => {
		const ctx = await mountFigma(renameSelection);
		const targets = ['first', 'second'].map((name) => addRectangle(ctx, name));
		ctx.selection.select(targets.map((node) => node.id));
		await launch(ctx);
		expect(targets.map((node) => ctx.document.require(node.id).name)).toEqual([
			'Layer 1',
			'Layer 2'
		]);
		expect(ctx.document.require(targets[1].id).pluginData['plugin:sample']).toEqual({
			renamedAt: '2'
		});
		expect(ctx.pluginToasts.toasts.listAll().map((toast) => toast.message)).toEqual([
			'Renamed 2 layers'
		]);
		expect(ctx.history.undo()).toBe(true);
		expect(targets.map((node) => ctx.document.require(node.id).name)).not.toContain('Layer 1');
	});

	it('closes with a message when nothing is selected', async () => {
		const ctx = await mountFigma(renameSelection);
		ctx.selection.select([]);
		await launch(ctx);
		expect(ctx.pluginToasts.toasts.listAll().map((toast) => toast.message)).toEqual([
			'Select some layers first'
		]);
	});
});

describe('sample Figma plugin 3: text card', () => {
	it('builds a card with text, groups layers and keeps a counter in clientStorage', async () => {
		const ctx = await mountFigma(textCard);
		await launch(ctx);
		const card = ctx.document.query((node) => node.name === 'Card')[0];
		expect(card).toMatchObject({ type: 'FRAME', width: 240, height: 120, cornerRadius: 12 });
		const badge = ctx.document.childNodes(card.id)[0];
		expect(badge).toMatchObject({ type: 'GROUP', name: 'Badge' });
		if (badge.type !== 'GROUP') throw new Error('expected a group');
		const [title, dot] = ctx.document.childNodes(badge.id);
		expect(title).toMatchObject({ type: 'TEXT', name: 'Title' });
		if (title.type !== 'TEXT') throw new Error('expected text');
		expect(title.defaultStyle.fontSize).toBe(24);
		expect(title.paragraphs[0].runs[0].text).toBe('Hello Figma');
		expect(dot.type).toBe('ELLIPSE');
		expect(title.transform[0][2]).toBe(0);
		expect(badge.transform[0][2]).toBe(16);
		expect(state.storage.sample).toEqual({ runs: 1 });
		expect(ctx.pluginToasts.toasts.listAll().map((toast) => toast.message)).toEqual([
			'Run 1, 1 text layer'
		]);

		await launch(ctx);
		expect(state.storage.sample).toEqual({ runs: 2 });
	});
});

describe('unsupported API', () => {
	const PROBE = `
		const attempt = (label, action) => {
			try { action(); design.log.info(label, 'ok'); }
			catch (error) { design.log.info(label, error.name, error.message); }
		};
		attempt('createPage', () => figma.createPage());
		attempt('ui', () => figma.ui);
		attempt('showUI', () => figma.showUI('<p>hi</p>'));
		attempt('effects', () => figma.createRectangle().effects);
		attempt('gradient', () => { figma.createRectangle().fills = [{ type: 'GRADIENT_LINEAR' }]; });
		attempt('currentPage', () => { figma.currentPage = null; });
		attempt('on', () => figma.on('documentchange', () => {}));
		design.log.info('detect', typeof figma.somethingNew);
		figma.closePlugin();
	`;

	it('throws a documented FigmaCompatError and keeps feature detection working', async () => {
		const ctx = await mountFigma(PROBE);
		await launch(ctx);
		const lines = logs(ctx);
		const named = (label: string): string => {
			const line = lines.find((entry) => entry.startsWith(`${label} `));
			if (line === undefined) throw new Error(`no log for ${label}`);
			return line;
		};
		expect(named('createPage')).toContain(
			'FigmaCompatError figma.createPage is not supported by the Figma compatibility layer'
		);
		expect(named('createPage')).toContain('docs/plugins/figma-compat.md');
		expect(named('ui')).toContain('figma.ui is not supported');
		expect(named('showUI')).toContain('HTML string');
		expect(named('effects')).toContain('node.effects is not supported');
		expect(named('gradient')).toContain('only SOLID paints can be set');
		expect(named('currentPage')).toContain('setting figma.currentPage');
		expect(named('on')).toContain('only selectionchange and close');
		expect(named('detect')).toBe('detect undefined');
	});
});

describe('compatibility table', () => {
	const documentation = readFileSync('docs/plugins/figma-compat.md', 'utf8');

	it('lists every supported and unsupported member in the docs', () => {
		const members = [
			...COMPAT_TABLE.supportedFigma,
			...COMPAT_TABLE.supportedNode,
			...Object.keys(COMPAT_TABLE.unsupportedFigma),
			...Object.keys(COMPAT_TABLE.unsupportedNode)
		];
		const missing = members.filter((member) => !documentation.includes(`\`${member}\``));
		expect(missing).toEqual([]);
	});
});
