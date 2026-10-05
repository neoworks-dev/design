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
import pluginApi from '../plugin-api';
import pluginStorage from './index';

interface PluginSetup {
	id: string;
	source: string;
	permissions?: string[];
}

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;
let state: FakePluginState = newFakePluginState();

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

async function mountStorage(...setups: PluginSetup[]): Promise<Context> {
	workers = inlineWorkers();
	state = newFakePluginState();
	const files: Record<string, string> = {};
	const plugins = setups.map((setup) => {
		files[`user/${setup.id}/main.js`] = setup.source;
		const manifest = validManifest({
			id: setup.id,
			permissions: setup.permissions ?? ['document:read', 'document:write', 'storage'],
			contributes: { commands: [{ id: `${setup.id}.run`, title: 'Run' }] }
		});
		return discovered(manifest, { directoryName: setup.id });
	});
	const list = listOf(...plugins);
	mounted = await mountPlugin(pluginStorage, {
		providers: [...pluginApiProviders(workers.factory), pluginApi],
		desktop: { plugins: fakePluginsSection(() => list, files, state) }
	});
	await settle();
	return mounted.ctx;
}

function pluginDataOf(ctx: Context, name: string): Record<string, Record<string, string>> {
	const node = ctx.document.childNodes(ctx.document.currentPageId).find((n) => n.name === name);
	if (node === undefined) throw new Error(`no node ${name}`);
	return node.pluginData;
}

const WRITE = `
	await design.commands.register('writer.run', async () => {
		const id = await design.document.createNode('RECTANGLE', { name: 'Card' });
		await design.storage.setData(id, 'color', 'red');
		await design.storage.setSharedData(id, 'palette', 'primary', 'blue');
		await design.storage.setRelaunchData(id, { 'writer.run': 'Edit card' });
		design.log.info('read', await design.storage.getData(id, 'color'), await design.storage.getSharedData(id, 'palette', 'primary'));
	});
`;

describePlugin('plugin-storage', pluginStorage, {
	providers: [...pluginApiProviders(inlineWorkers().factory), pluginApi],
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		expect(ctx.pluginStorage).toBeDefined();
		expect(ctx.pluginHost.snapshotState().apis).toContain('storage');
	}
});

describe('plugin data on nodes', () => {
	it('stores private and shared data in the node and undoes it with the run', async () => {
		const ctx = await mountStorage({ id: 'writer', source: WRITE });
		await ctx.commands.run('writer.run');
		expect(pluginDataOf(ctx, 'Card')).toEqual({
			'plugin:writer': {
				color: 'red',
				relaunchData: JSON.stringify({ 'writer.run': 'Edit card' })
			},
			'shared:palette': { primary: 'blue' }
		});
		expect(ctx.pluginHost.connectionOf('writer')?.logs.map((line) => line.message)).toEqual([
			'read red blue'
		]);
		expect(ctx.history.undo()).toBe(true);
		expect(ctx.document.childNodes(ctx.document.currentPageId).map((n) => n.name)).not.toContain(
			'Card'
		);
	});

	it('keeps private data private and lets plugins share a namespace', async () => {
		const reader = `
			await design.commands.register('reader.run', async () => {
				const page = await design.document.currentPage();
				const [card] = await design.document.query({ name: 'Card' });
				design.log.info('private', JSON.stringify(await design.storage.getData(card.id, 'color')));
				design.log.info('shared', await design.storage.getSharedData(card.id, 'palette', 'primary'));
				await design.storage.setSharedData(card.id, 'palette', 'primary', 'green');
			});
		`;
		const ctx = await mountStorage(
			{ id: 'writer', source: WRITE },
			{ id: 'reader', source: reader }
		);
		await ctx.commands.run('writer.run');
		await ctx.commands.run('reader.run');
		const logs = ctx.pluginHost.connectionOf('reader')?.logs.map((line) => line.message);
		expect(logs).toEqual(['private ""', 'shared blue']);
		expect(pluginDataOf(ctx, 'Card')['shared:palette']).toEqual({ primary: 'green' });
	});

	it('deletes a key when set to the empty string and drops the empty namespace', async () => {
		const source = `
			await design.commands.register('eraser.run', async () => {
				const id = await design.document.createNode('RECTANGLE', { name: 'Card' });
				await design.storage.setData(id, 'k', 'v');
				await design.storage.setData(id, 'k', '');
			});
		`;
		const ctx = await mountStorage({ id: 'eraser', source });
		await ctx.commands.run('eraser.run');
		expect(pluginDataOf(ctx, 'Card')).toEqual({});
	});

	it('refuses an entry above 100 kB and a namespace that is too short', async () => {
		const source = `
			await design.commands.register('big.run', async () => {
				const id = await design.document.createNode('RECTANGLE', { name: 'Card' });
				try { await design.storage.setData(id, 'k', 'x'.repeat(100001)); }
				catch (error) { design.log.info('cap', error.message); }
				await design.storage.setData(id, 'k', 'x'.repeat(99000));
				design.log.info('under', (await design.storage.getData(id, 'k')).length);
				try { await design.storage.setSharedData(id, 'ab', 'k', 'v'); }
				catch (error) { design.log.info('namespace', error.message); }
			});
		`;
		const ctx = await mountStorage({ id: 'big', source });
		await ctx.commands.run('big.run');
		const logs = ctx.pluginHost.connectionOf('big')?.logs.map((line) => line.message);
		expect(logs?.[0]).toContain('larger than 100 kB');
		expect(logs?.[1]).toBe('under 99000');
		expect(logs?.[2]).toContain('not a valid namespace');
	});

	it('needs the storage permission', async () => {
		const source = `
			try { await hostCall('storage.dataKeys', { nodeId: 'x' }); }
			catch (error) { design.log.info(error.remoteName); }
		`;
		const ctx = await mountStorage({ id: 'nostore', source, permissions: ['document:read'] });
		await ctx.pluginHost.activate('nostore');
		await settle();
		expect(ctx.pluginHost.connectionOf('nostore')?.logs[0].message).toBe('PermissionDeniedError');
	});
});

describe('relaunch data', () => {
	it("lists a node's relaunch buttons and runs the plugin command again from one", async () => {
		const ctx = await mountStorage({ id: 'writer', source: WRITE });
		await ctx.commands.run('writer.run');
		const card = ctx.document.query((node) => node.name === 'Card')[0];
		const [action] = ctx.pluginStorage.relaunchActions(card.id);
		expect(action).toEqual({ pluginId: 'writer', command: 'writer.run', label: 'Edit card' });
		await ctx.pluginStorage.runRelaunch(action, card.id);
		expect(ctx.pluginHost.connectionOf('writer')?.logs.map((line) => line.message)).toEqual([
			'read red blue',
			'read red blue'
		]);
	});
});

describe('clientStorage', () => {
	const CLIENT = `
		const storage = design.storage.clientStorage;
		await storage.set('theme', { dark: true });
		await storage.set('count', 3);
		design.log.info('get', JSON.stringify(await storage.get('theme')));
		design.log.info('missing', String(await storage.get('nope')));
		design.log.info('keys', (await storage.keys()).join(','));
		await storage.delete('count');
		design.log.info('after delete', (await storage.keys()).join(','));
	`;

	it('stores JSON per plugin outside the document', async () => {
		const ctx = await mountStorage({ id: 'client', source: CLIENT }, { id: 'other', source: '' });
		await ctx.pluginHost.activate('client');
		await settle();
		expect(ctx.pluginHost.connectionOf('client')?.logs.map((line) => line.message)).toEqual([
			'get {"dark":true}',
			'missing undefined',
			'keys theme,count',
			'after delete theme'
		]);
		expect(state.storage).toEqual({ client: { theme: { dark: true } } });
		expect(ctx.history.canUndo).toBe(false);
	});
});
