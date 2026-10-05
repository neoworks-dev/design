import { afterEach, describe, expect, it } from 'vitest';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginApiProviders,
	validManifest
} from '../../lib/plugins/fixtures/pluginFixture';
import { inlineWorkers, type InlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { Context } from '@neoworks/extension-system';
import pluginApi from './index';

interface Setup {
	id?: string;
	source: string;
	manifest?: Record<string, unknown>;
}

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;
let zoomed: string[][] = [];

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

async function mountApi(setup: Setup): Promise<Context> {
	const id = setup.id === undefined ? 'example' : setup.id;
	workers = inlineWorkers();
	zoomed = [];
	const manifest = validManifest({
		id,
		permissions: ['document:read', 'document:write', 'selection', 'ui:tool', 'ai'],
		...setup.manifest
	});
	const list = listOf(discovered(manifest, { directoryName: id }));
	mounted = await mountPlugin(pluginApi, {
		providers: pluginApiProviders(workers.factory, { zoomed }),
		desktop: { plugins: fakePluginsSection(() => list, { [`user/${id}/main.js`]: setup.source }) }
	});
	await settle();
	return mounted.ctx;
}

function commandManifest(...ids: string[]): Record<string, unknown> {
	return {
		contributes: { commands: ids.map((id) => ({ id: `example.${id}`, title: id })) }
	};
}

const MAKE_TWO = `
	await design.commands.register('example.make', async () => {
		await design.document.createNode('RECTANGLE', { name: 'One', x: 0, y: 0, width: 10, height: 10 });
		await design.document.createNode('ELLIPSE', { name: 'Two', x: 20, y: 0, width: 10, height: 10 });
	});
`;

function namesOnPage(ctx: Context): string[] {
	return ctx.document.childNodes(ctx.document.currentPageId).map((node) => node.name);
}

describePlugin('plugin-api', pluginApi, {
	providers: pluginApiProviders(inlineWorkers().factory),
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		const state = ctx.pluginHost.snapshotState();
		expect(state.apis).toEqual(
			expect.arrayContaining(['document', 'selection', 'commands', 'menus', 'tools', 'aiTools'])
		);
		expect(state.runScopes).toBe(1);
		expect(state.eventPermissions).toContain('selectionchange');
	}
});

describe('plugin API: writes and undo', () => {
	it('creates nodes in a command and one undo removes them all', async () => {
		const ctx = await mountApi({ source: MAKE_TWO, manifest: commandManifest('make') });
		const before = namesOnPage(ctx);
		const stepsBefore = ctx.history.entries.length;

		await ctx.commands.run('example.make');

		expect(namesOnPage(ctx)).toEqual([...before, 'One', 'Two']);
		expect(ctx.history.entries).toHaveLength(stepsBefore + 1);
		expect(ctx.history.undoLabel).toBe('make');
		expect(ctx.history.entries.at(-1)?.origin).toBe('plugin');

		expect(ctx.history.undo()).toBe(true);
		expect(namesOnPage(ctx)).toEqual(before);
		expect(ctx.history.redo()).toBe(true);
		expect(namesOnPage(ctx)).toEqual([...before, 'One', 'Two']);
	});

	it('splits a run into two undo steps at commitUndo()', async () => {
		const source = `
			await design.commands.register('example.split', async () => {
				await design.document.createNode('RECTANGLE', { name: 'First' });
				await design.commitUndo();
				await design.document.createNode('RECTANGLE', { name: 'Second' });
			});
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('split') });
		const before = namesOnPage(ctx);
		const stepsBefore = ctx.history.entries.length;
		await ctx.commands.run('example.split');
		expect(ctx.history.entries).toHaveLength(stepsBefore + 2);
		ctx.history.undo();
		expect(namesOnPage(ctx)).toEqual([...before, 'First']);
		ctx.history.undo();
		expect(namesOnPage(ctx)).toEqual(before);
	});

	it('leaves no history step for a run that changed nothing', async () => {
		const source = `await design.commands.register('example.noop', async () => { await design.document.getNode('f'); });`;
		const ctx = await mountApi({ source, manifest: commandManifest('noop') });
		const stepsBefore = ctx.history.entries.length;
		await ctx.commands.run('example.noop');
		expect(ctx.history.entries).toHaveLength(stepsBefore);
	});

	it('applies create, set, move and delete with refs as one transaction', async () => {
		const source = `
			await design.commands.register('example.ops', async () => {
				const result = await design.document.apply([
					{ op: 'create', type: 'FRAME', ref: 'box', props: { name: 'Box', width: 100, height: 100 } },
					{ op: 'create', type: 'RECTANGLE', parentId: 'box', props: { name: 'Inside', fill: '#00ff00' } },
					{ op: 'set', id: 'a', props: { name: 'Renamed A' } },
					{ op: 'delete', id: 'c' }
				]);
				design.log.info('result', JSON.stringify({ created: result.created.length, changed: result.changed, deleted: result.deleted }));
			});
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('ops') });
		await ctx.commands.run('example.ops');
		const box = ctx.document.query((node) => node.name === 'Box')[0];
		expect(ctx.document.childNodes(box.id).map((node) => node.name)).toEqual(['Inside']);
		expect(ctx.document.get('a')?.name).toBe('Renamed A');
		expect(ctx.document.has('c')).toBe(false);
		const connection = ctx.pluginHost.connectionOf('example');
		expect(connection?.logs.at(-1)?.message).toBe(
			'result {"created":2,"changed":["a"],"deleted":["c"]}'
		);
	});

	it('rolls back every operation of a call when one fails', async () => {
		const source = `
			await design.commands.register('example.bad', async () => {
				try {
					await design.document.apply([
						{ op: 'create', type: 'RECTANGLE', props: { name: 'Ghost' } },
						{ op: 'set', id: 'missing', props: { name: 'x' } }
					]);
				} catch (error) {
					design.log.info('failed', error.message);
				}
			});
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('bad') });
		const before = namesOnPage(ctx);
		await ctx.commands.run('example.bad');
		expect(namesOnPage(ctx)).toEqual(before);
		const message = ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message;
		expect(message).toContain('operation 2 (set)');
		expect(message).toContain('node missing does not exist');
	});

	it('refuses malformed parameters with the offending field', async () => {
		const source = `
			await design.commands.register('example.junk', async () => {
				for (const operations of [[{ op: 'explode', id: 'a' }], [{ op: 'create', type: 'PAGE' }], []]) {
					try { await design.document.apply(operations); design.log.info('accepted'); }
					catch (error) { design.log.info('refused'); }
				}
			});
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('junk') });
		await ctx.commands.run('example.junk');
		const lines = ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message);
		expect(lines).toEqual(['refused', 'refused', 'refused']);
	});

	it('does not need a command to write: a write outside a run is its own undo step', async () => {
		const source = `
			await design.document.createNode('RECTANGLE', { name: 'Loose' });
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('unused') });
		const stepsBefore = ctx.history.entries.length;
		await ctx.pluginHost.activate('example');
		await settle();
		expect(namesOnPage(ctx)).toContain('Loose');
		expect(ctx.history.entries).toHaveLength(stepsBefore + 1);
		expect(ctx.history.undoLabel).toBe('Example');
	});
});

describe('plugin API: reads', () => {
	it('reads nodes, children, queries, pages and the selection', async () => {
		const source = `
			const page = await design.document.currentPage();
			const node = await design.document.getNode('a');
			const missing = await design.document.getNode('nope');
			const kids = await design.document.getChildren('f');
			const found = await design.document.query({ type: 'RECTANGLE', name: 'b' });
			const pages = await design.document.pages();
			await design.selection.set(['a', 'b']);
			const selected = await design.selection.get();
			const selectedNodes = await design.selection.nodes();
			design.log.info(JSON.stringify({
				page: page.id, node: node.name, missing,
				kids: kids.map((kid) => kid.id), found: found.map((item) => item.id),
				pages: pages.length, selected, nodes: selectedNodes.map((item) => item.id)
			}));
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		const logged = ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message;
		expect(JSON.parse(logged ?? '{}')).toEqual({
			page: 'p',
			node: 'a',
			missing: null,
			kids: ['a', 'b', 'c'],
			found: ['b'],
			pages: 1,
			selected: ['a', 'b'],
			nodes: ['a', 'b']
		});
		expect([...ctx.selection.ids]).toEqual(['a', 'b']);
	});

	it('reads the viewport and zooms into layers', async () => {
		const source = `
			design.log.info(JSON.stringify(await design.viewport.get()));
			await design.viewport.scrollAndZoomIntoView(['a']);
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe(
			'{"x":12,"y":34,"zoom":2}'
		);
		expect(zoomed).toEqual([['a']]);
	});
});

describe('plugin API: events', () => {
	it('delivers selectionchange, currentpagechange, documentchange and viewportchange', async () => {
		const source = `
			for (const name of ['selectionchange', 'documentchange', 'viewportchange']) {
				design.on(name, (payload) => design.log.info(name, JSON.stringify(payload)));
			}
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		ctx.selection.select(['a']);
		ctx.document.apply(ctx.document.setProps('a', { name: 'Edited' }), {
			origin: 'user',
			label: 'Rename'
		});
		ctx.emit('viewport/change', { x: 5, y: 6, scale: 3 });
		await settle();
		const lines = ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message) ?? [];
		expect(lines.some((line) => line.startsWith('selectionchange {"ids":["a"]'))).toBe(true);
		const change = lines.find((line) => line.startsWith('documentchange'));
		expect(change).toContain('"origin":"user"');
		expect(change).toContain('"label":"Rename"');
		expect(change).toContain('"PROPERTY_CHANGE"');
		expect(lines).toContain('viewportchange {"x":5,"y":6,"zoom":3}');
	});

	it('tags the plugin`s own changes with origin plugin', async () => {
		const source = `
			design.on('documentchange', (payload) => design.log.info('origin', payload.origin));
			await design.commands.register('example.touch', () => design.document.setProps('a', { name: 'Touched' }));
		`;
		const ctx = await mountApi({ source, manifest: commandManifest('touch') });
		await ctx.pluginHost.activate('example');
		await ctx.commands.run('example.touch');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message)).toContain(
			'origin plugin'
		);
	});

	it('refuses to subscribe without the permission the event needs', async () => {
		const source = `
			try { design.on('selectionchange', () => {}); await new Promise((r) => setTimeout(r, 10)); design.log.info('subscribed'); }
			catch (error) { design.log.info('refused'); }
		`;
		const ctx = await mountApi({ source, manifest: { permissions: ['document:read'] } });
		await ctx.pluginHost.activate('example');
		await settle();
		const connection = ctx.pluginHost.connectionOf('example');
		expect(connection?.subscriptions.has('selectionchange')).toBe(false);
	});
});

describe('plugin API: permissions and prefixes', () => {
	it('refuses writes and reads the manifest did not ask for', async () => {
		const source = `
			for (const call of [
				() => design.document.createNode('RECTANGLE'),
				() => design.document.currentPage(),
				() => design.selection.get()
			]) {
				try { await call(); design.log.info('allowed'); }
				catch (error) { design.log.info(error.message); }
			}
		`;
		const ctx = await mountApi({ source, manifest: { permissions: ['selection'] } });
		await ctx.pluginHost.activate('example');
		await settle();
		const lines = ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message);
		expect(lines?.[0]).toContain('did not declare the "document:write" permission');
		expect(lines?.[1]).toContain('did not declare the "document:read" permission');
		expect(lines?.[2]).toBe('allowed');
	});

	it('asks the plugins/permission hook before a permitted call', async () => {
		const source = `
			try { await design.document.currentPage(); design.log.info('allowed'); }
			catch (error) { design.log.info(error.message); }
		`;
		const ctx = await mountApi({ source });
		ctx.on('plugins/permission', (request) => `${request.method} is paused`);
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe(
			'document.currentPage is paused'
		);
	});

	it('requires registered ids to start with the plugin id', async () => {
		const source = `
			try { await design.commands.register('other.cmd', () => {}); design.log.info('ok'); }
			catch (error) { design.log.info(error.message); }
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toContain(
			'must start with "example."'
		);
		expect(ctx.commands.has('other.cmd')).toBe(false);
	});

	it('does not let a plugin run the app`s own commands', async () => {
		const source = `
			try { await design.commands.run('app.quit'); design.log.info('ran'); }
			catch (error) { design.log.info(error.message); }
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe(
			'command "app.quit" is not available to plugins'
		);
	});
});

describe('plugin API: registrations and unloading', () => {
	const REGISTER_ALL = `
		await design.commands.register('example.dynamic', () => design.log.info('dynamic ran'), { title: 'Dynamic' });
		await design.menus.register({ menu: 'app/plugins', id: 'example.item', command: 'example.dynamic' });
		await design.tools.register({ id: 'example.brush', title: 'Brush' }, {
			onPointer: (event) => design.log.info('pointer', event.phase, event.world.x)
		});
		await design.aiTools.register(
			{ id: 'example_count', description: 'Count the layers' },
			async () => ({ count: (await design.document.getChildren('f')).length })
		);
		await design.codegen.register({ id: 'example.lang', label: 'Example lang' }, ({ node }) => [
			{ title: 'Name', code: 'name = ' + node.name }
		]);
	`;

	it('registers commands, menu items, tools, AI tools and codegen at run time', async () => {
		const ctx = await mountApi({ source: REGISTER_ALL });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.commands.has('example.dynamic')).toBe(true);
		expect(ctx.menus.resolve('app/plugins').map((item) => item.id)).toContain('example.item');
		expect(ctx.tools.registry.has('example.brush')).toBe(true);
		expect(ctx.ai.tools.has('example_count')).toBe(true);
		expect(ctx.codegen.provider('example.lang')).toBeDefined();

		await ctx.commands.run('example.dynamic');
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe('dynamic ran');

		const answer = await ctx.ai.tools.get('example_count')?.run({}, {} as never);
		expect(answer).toBe('{"count":3}');

		ctx.tools.activate('example.brush');
		ctx.tools.pointerDown({
			screen: { x: 1, y: 2 },
			world: { x: 7, y: 8 },
			button: 0,
			detail: 1,
			pointerId: 1,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false
		});
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe('pointer down 7');
	});

	it('answers codegen asynchronously through a reactive cache', async () => {
		const ctx = await mountApi({ source: REGISTER_ALL });
		await ctx.pluginHost.activate('example');
		await settle();
		const first = ctx.codegen.generate('example.lang', 'a');
		expect(first[0].code).toBe('Generating...');
		await settle();
		expect(ctx.codegen.generate('example.lang', 'a')[0]).toEqual({
			title: 'Name',
			code: 'name = a'
		});
	});

	it('removes its registrations when the plugin stops, but keeps what it changed in the document', async () => {
		const source = `${REGISTER_ALL}
			await design.document.createNode('RECTANGLE', { name: 'Kept' });
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.commands.has('example.dynamic')).toBe(true);

		await ctx.pluginHost.deactivate('example');
		expect(ctx.commands.has('example.dynamic')).toBe(false);
		expect(ctx.menus.resolve('app/plugins')).toEqual([]);
		expect(ctx.tools.registry.has('example.brush')).toBe(false);
		expect(ctx.ai.tools.has('example_count')).toBe(false);
		expect(ctx.codegen.provider('example.lang')).toBeUndefined();
		expect(namesOnPage(ctx)).toContain('Kept');
	});

	it('removes one registration through its handle', async () => {
		const source = `
			const handle = await design.commands.register('example.temp', () => {}, { title: 'Temp' });
			await design.commands.register('example.stay', () => {}, { title: 'Stay' });
			await handle.dispose();
		`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.commands.has('example.temp')).toBe(false);
		expect(ctx.commands.has('example.stay')).toBe(true);
	});

	it('refuses deleting protected layers, and lets go when the plugin stops', async () => {
		const source = `await design.document.protect(['a'], 'it is the logo');`;
		const ctx = await mountApi({ source });
		await ctx.pluginHost.activate('example');
		await settle();
		expect(() =>
			ctx.document.apply(ctx.document.removeNode('a'), { origin: 'user', label: 'Delete' })
		).toThrow('example protects "a": it is the logo');
		expect(ctx.document.has('a')).toBe(true);

		await ctx.pluginHost.deactivate('example');
		ctx.document.apply(ctx.document.removeNode('a'), { origin: 'user', label: 'Delete' });
		expect(ctx.document.has('a')).toBe(false);
	});

	it('lets a plugin hook the manifest-declared command with a handler only', async () => {
		const source = `await design.commands.register('example.make', () => design.log.info('ran'));`;
		const ctx = await mountApi({ source, manifest: commandManifest('make') });
		await ctx.commands.run('example.make');
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe('ran');
		expect(ctx.commands.list().filter((command) => command.id === 'example.make')).toHaveLength(1);
	});

	it('serves manifest-declared AI tools and codegen as lazy stubs', async () => {
		const source = `
			await design.aiTools.register({ id: 'example_hello', description: 'Say hello' }, () => 'hello');
		`;
		const ctx = await mountApi({
			source,
			manifest: {
				contributes: {
					aiTools: [{ id: 'example_hello', description: 'Say hello' }]
				}
			}
		});
		expect(workers.created).toEqual([]);
		const answer = await ctx.ai.tools.get('example_hello')?.run({}, {} as never);
		expect(answer).toBe('hello');
		expect(workers.created).toHaveLength(1);
	});
});
