import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginList } from '../../../electron/bridge';
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
import pluginPermissions from '../plugin-permissions';
import { ResourceSearchService } from '../resources-search/service';
import pluginManager from './index';

const resourceSearchStub: Plugin = {
	name: 'resources-search',
	inject: [],
	apply(ctx: Context): void {
		new ResourceSearchService(ctx);
	}
};

const SOURCE = `
	await design.commands.register('example.hello', async () => { design.log.info('hello ran'); });
`;

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;
let state: FakePluginState = newFakePluginState();
let installed: PluginList | null = null;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function wait(milliseconds = 20): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pluginsList(): PluginList {
	const manifest = validManifest({
		description: 'Says hello',
		contributes: { commands: [{ id: 'example.hello', title: 'Say hello' }] }
	});
	return {
		plugins: [discovered(manifest, { directoryName: 'example' })],
		project: '/projects/demo',
		projectTrust: 'undecided'
	};
}

async function mountManager(decisions = {}): Promise<Context> {
	workers = inlineWorkers();
	state = newFakePluginState(decisions);
	installed = null;
	const list = pluginsList();
	const section = fakePluginsSection(() => list, { 'user/example/main.js': SOURCE }, state);
	section.list = () => Promise.resolve(list);
	section.installFromDialog = () => Promise.resolve(installed);
	section.install = () => Promise.reject(new Error('no manifest.json'));
	mounted = await mountPlugin(pluginManager, {
		providers: [
			...pluginApiProviders(workers.factory),
			pluginApi,
			pluginPermissions,
			resourceSearchStub
		],
		desktop: { plugins: section }
	});
	await wait();
	return mounted.ctx;
}

describePlugin('plugin-manager', pluginManager, {
	providers: [
		...pluginApiProviders(inlineWorkers().factory),
		pluginApi,
		pluginPermissions,
		resourceSearchStub
	],
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx, currentState }) => {
		expect(ctx.commands.has('plugin-manager.open')).toBe(true);
		expect(currentState().registries['keymap.registry']).toContain(
			'plugin-manager|global|ctrl+alt+p|plugin-manager.open'
		);
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'plugin-manager/dialog'
		);
		expect(ctx.resourceSearch.providers.has('plugin-manager/plugins')).toBe(true);
	}
});

describe('the list', () => {
	it('shows each plugin with its state, commands and permissions', async () => {
		const ctx = await mountManager();
		const [row] = ctx.pluginManager.rows();
		expect(row).toMatchObject({
			id: 'example',
			name: 'Example',
			status: 'inactive',
			source: 'user',
			enabled: true,
			removable: true,
			commands: [{ id: 'example.hello', title: 'Say hello' }]
		});
		expect(row.permissions).toEqual([
			{ permission: 'document:read', decision: 'undecided' },
			{ permission: 'document:write', decision: 'undecided' }
		]);
	});

	it('changes what a plugin may do and remembers it', async () => {
		const ctx = await mountManager();
		await ctx.pluginManager.setPermission('example', 'document:write', true);
		await ctx.pluginManager.setPermission('example', 'document:read', false);
		const decisions = ctx.pluginManager.rows()[0].permissions;
		expect(decisions.map((entry) => entry.decision)).toEqual(['denied', 'granted']);
		expect(state.decisions.example).toEqual({ 'document:read': false, 'document:write': true });
	});

	it('keeps the project and its trust from the list main sends', async () => {
		const ctx = await mountManager();
		expect(ctx.pluginManager.project).toBe('/projects/demo');
		expect(ctx.pluginManager.projectTrust).toBe('undecided');
	});
});

describe('enable and disable', () => {
	it('round-trips with the plugin unloaded and its effects reverted', async () => {
		const ctx = await mountManager();
		expect(ctx.commands.has('example.hello')).toBe(true);
		await ctx.commands.run('example.hello');
		expect(workers.alive()).toEqual(['example']);

		await ctx.pluginManager.setEnabled('example', false);
		await wait();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('disabled');
		expect(ctx.pluginManager.rows()[0]).toMatchObject({ status: 'disabled', enabled: false });
		expect(ctx.commands.has('example.hello')).toBe(false);
		expect(workers.alive()).toEqual([]);
		expect(state.decisions.example).toEqual({ enabled: false });

		await ctx.pluginManager.setEnabled('example', true);
		await wait();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('inactive');
		expect(ctx.commands.has('example.hello')).toBe(true);
		await ctx.commands.run('example.hello');
		expect(ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message)).toEqual([
			'hello ran'
		]);
	});

	it('starts a plugin the user turned off earlier as disabled', async () => {
		const ctx = await mountManager({ example: { enabled: false } });
		await ctx.pluginPermissions.load();
		await wait();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('disabled');
		expect(ctx.commands.has('example.hello')).toBe(false);
	});

	it('enables everything again when the manager unloads', async () => {
		const ctx = await mountManager({ example: { enabled: false } });
		await ctx.pluginPermissions.load();
		await wait();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('disabled');
		await mounted?.fiber.dispose();
		await wait();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('inactive');
	});
});

describe('installing', () => {
	it('adopts the list main answers after the dialog', async () => {
		const ctx = await mountManager();
		installed = { ...pluginsList(), projectTrust: 'trusted' };
		await ctx.pluginManager.installFromDialog('folder');
		expect(ctx.pluginManager.projectTrust).toBe('trusted');
		expect(ctx.pluginManager.notice).toEqual({ text: 'Plugin installed', error: false });
	});

	it('says nothing when the dialog is cancelled', async () => {
		const ctx = await mountManager();
		await ctx.pluginManager.installFromDialog('zip');
		expect(ctx.pluginManager.notice).toBeNull();
	});

	it('shows an error from main in the notice', async () => {
		const ctx = await mountManager();
		await ctx.pluginManager.installPath('/nowhere');
		expect(ctx.pluginManager.notice).toEqual({ text: 'no manifest.json', error: true });
	});
});

describe('Resources search', () => {
	it('lists installed plugins with a Run button and runs the first command', async () => {
		const ctx = await mountManager();
		const [item] = ctx.resourceSearch.itemsFor('');
		expect(item).toMatchObject({
			title: 'Example',
			subtitle: 'Plugin · 1.0.0 · Says hello',
			actionLabel: 'Run'
		});
		await item.run();
		expect(ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message)).toEqual([
			'hello ran'
		]);
	});

	it('does not offer a disabled plugin', async () => {
		const ctx = await mountManager();
		await ctx.pluginManager.setEnabled('example', false);
		await wait();
		expect(ctx.resourceSearch.itemsFor('')).toEqual([]);
	});
});
