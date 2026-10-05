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
import pluginPermissions from './index';

const READ_PAGE = `
	try {
		const page = await design.document.currentPage();
		design.log.info('read', page.type);
	} catch (error) {
		design.log.info('refused', error.name, error.message);
	}
`;

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

async function mountWith(
	source: string,
	options: {
		manifest?: Record<string, unknown>;
		pluginSource?: 'user' | 'builtin';
		decisions?: Record<string, Record<string, boolean>>;
	} = {}
): Promise<MountedPlugin> {
	workers = inlineWorkers();
	state = newFakePluginState(options.decisions);
	const manifest = validManifest({
		permissions: ['document:read', 'network'],
		networkAccess: { allowedDomains: ['api.example.com'] },
		...options.manifest
	});
	const list = listOf(discovered(manifest, { source: options.pluginSource }));
	const prefix = options.pluginSource === 'builtin' ? 'builtin' : 'user';
	mounted = await mountPlugin(pluginPermissions, {
		providers: [...pluginApiProviders(workers.factory), pluginApi],
		desktop: {
			plugins: fakePluginsSection(() => list, { [`${prefix}/example/main.js`]: source }, state)
		}
	});
	await settle();
	return mounted;
}

describePlugin('plugin-permissions', pluginPermissions, {
	providers: pluginApiProviders(inlineWorkers().factory),
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		expect(ctx.pluginPermissions).toBeDefined();
		expect(ctx.pluginHost.snapshotState().apis).toContain('network');
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'plugin-permissions/prompt'
		);
	}
});

describe('plugin permission prompts', () => {
	it('asks once on first use, runs the call when allowed and remembers the answer', async () => {
		const { ctx } = await mountWith(READ_PAGE);
		const activation = ctx.pluginHost.activate('example');
		await settle();
		const prompts = ctx.pluginPermissions.prompts.listAll();
		expect(prompts).toHaveLength(1);
		expect(prompts[0].permissions).toEqual(['document:read', 'network']);
		prompts[0].answer(true);
		const connection = await activation;
		await settle();
		expect(connection.logs.map((line) => line.message)).toEqual(['read PAGE']);
		expect(state.decisions.example).toEqual({ 'document:read': true, network: true });

		await ctx.pluginHost.restart('example');
		await settle();
		expect(ctx.pluginPermissions.prompts.listAll()).toHaveLength(0);
		expect(ctx.pluginHost.connectionOf('example')?.logs[0].message).toBe('read PAGE');
	});

	it('fails the call with a PermissionDeniedError when the user denies', async () => {
		const { ctx } = await mountWith(READ_PAGE);
		const activation = ctx.pluginHost.activate('example');
		await settle();
		ctx.pluginPermissions.prompts.listAll()[0].answer(false);
		const connection = await activation;
		await settle();
		expect(connection.logs[0].message).toContain('refused RpcError');
		expect(connection.logs[0].message).toContain('"document:read" was denied');
		expect(ctx.pluginPermissions.decisionFor('example', 'document:read')).toBe('denied');
	});

	it('names the error type so a plugin can tell a refusal from a failure', async () => {
		const { ctx } = await mountWith(`
			try { await hostCall('document.currentPage'); }
			catch (error) { design.log.info(error.remoteName); }
		`);
		const activation = ctx.pluginHost.activate('example');
		await settle();
		ctx.pluginPermissions.prompts.listAll()[0].answer(false);
		const connection = await activation;
		await settle();
		expect(connection.logs[0].message).toBe('PermissionDeniedError');
	});

	it('does not ask for a permission the manifest never declared', async () => {
		const { ctx } = await mountWith(READ_PAGE, { manifest: { permissions: [] } });
		const connection = await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginPermissions.prompts.listAll()).toHaveLength(0);
		expect(connection.logs[0].message).toContain('did not declare the "document:read" permission');
	});

	it('does not ask for bundled plugins, which hold what they declare', async () => {
		const { ctx } = await mountWith(READ_PAGE, { pluginSource: 'builtin' });
		const connection = await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginPermissions.prompts.listAll()).toHaveLength(0);
		expect(connection.logs.map((line) => line.message)).toEqual(['read PAGE']);
	});

	it('asks again after the user revokes a permission in the manager', async () => {
		const { ctx } = await mountWith(READ_PAGE, {
			decisions: { example: { 'document:read': true, network: true } }
		});
		await ctx.pluginPermissions.load();
		await ctx.pluginHost.activate('example');
		expect(ctx.pluginPermissions.prompts.listAll()).toHaveLength(0);
		await ctx.pluginPermissions.set('example', 'document:read', null);
		expect(ctx.pluginPermissions.decisionFor('example', 'document:read')).toBe('undecided');
		const restart = ctx.pluginHost.restart('example');
		await settle();
		expect(ctx.pluginPermissions.prompts.listAll()).toHaveLength(1);
		ctx.pluginPermissions.prompts.listAll()[0].answer(true);
		await restart;
	});
});

describe('plugin network access', () => {
	const FETCH = `
		try {
			const response = await design.network.fetch('https://api.example.com/data');
			design.log.info('fetched', response.status, response.text);
		} catch (error) {
			design.log.info('refused', error.message);
		}
	`;

	it('forwards a granted request to main with the plugin id', async () => {
		const { ctx } = await mountWith(FETCH, {
			decisions: { example: { 'document:read': true, network: true } }
		});
		await ctx.pluginPermissions.load();
		const connection = await ctx.pluginHost.activate('example');
		await settle();
		expect(connection.logs[0].message).toBe('fetched 200 ok');
		expect(state.fetched).toEqual([{ pluginId: 'example', url: 'https://api.example.com/data' }]);
	});

	it('refuses the request when the network permission is denied', async () => {
		const { ctx } = await mountWith(FETCH, {
			decisions: { example: { network: false } }
		});
		await ctx.pluginPermissions.load();
		const connection = await ctx.pluginHost.activate('example');
		await settle();
		expect(connection.logs[0].message).toContain('"network" was denied');
		expect(state.fetched).toEqual([]);
	});
});
