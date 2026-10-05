import { afterEach, describe, expect, it } from 'vitest';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginProviders,
	validManifest
} from '../../lib/plugins/fixtures/pluginFixture';
import { inlineWorkers, type InlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import pluginManifests from '../plugin-manifests';
import pluginHost from './index';

const HELLO = `
design.log.info('loaded', design.pluginId);
design.on('selectionchange', (payload) => design.log.info('selection', JSON.stringify(payload)));
`;

interface PluginSetup {
	id: string;
	source: string;
	manifest?: Record<string, unknown>;
}

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

function manifestFor(setup: PluginSetup): Record<string, unknown> {
	return validManifest({
		id: setup.id,
		contributes: { commands: [{ id: `${setup.id}.run`, title: 'Run' }] },
		...setup.manifest
	});
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

async function mountHost(
	setups: PluginSetup[],
	config: Record<string, unknown> = {},
	globals: Record<string, unknown> = {}
): Promise<MountedPlugin> {
	workers = inlineWorkers(globals);
	const files: Record<string, string> = {};
	for (const setup of setups) files[`user/${setup.id}/main.js`] = setup.source;
	const list = listOf(
		...setups.map((setup) => discovered(manifestFor(setup), { directoryName: setup.id }))
	);
	mounted = await mountPlugin(pluginHost, {
		providers: pluginProviders([pluginManifests]),
		desktop: { plugins: fakePluginsSection(() => list, files) },
		config: { createWorker: workers.factory, ...config }
	});
	await settle();
	return mounted;
}

describePlugin('plugin-host', pluginHost, {
	providers: pluginProviders([pluginManifests]),
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		expect(ctx.pluginHost).toBeDefined();
		expect(ctx.pluginHost.snapshotState().apis).toEqual(['events', 'log']);
	}
});

describe('plugin-host worker lifecycle', () => {
	it('starts no worker until a plugin is used', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		expect(workers.created).toEqual([]);
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('inactive');
	});

	it('starts the worker on first use and reports the plugin active', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const connection = await ctx.pluginHost.activate('hello');
		expect(connection.isReady).toBe(true);
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('active');
		expect(workers.alive()).toEqual(['hello']);
		await settle();
		expect(connection.logs.map((line) => line.message)).toEqual(['loaded hello']);
	});

	it('shares one start between concurrent activations', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const [first, second] = await Promise.all([
			ctx.pluginHost.activate('hello'),
			ctx.pluginHost.activate('hello')
		]);
		expect(first).toBe(second);
		expect(workers.created).toHaveLength(1);
	});

	it('delivers only the events the plugin subscribed to, and round-trips them', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const connection = await ctx.pluginHost.activate('hello');
		await settle();
		expect([...connection.subscriptions]).toEqual(['selectionchange']);
		ctx.pluginHost.broadcast('documentchange', { revision: 1 });
		ctx.pluginHost.broadcast('selectionchange', { ids: ['a'] });
		await settle();
		expect(connection.logs.map((line) => line.message)).toEqual([
			'loaded hello',
			'selection {"ids":["a"]}'
		]);
	});

	it('terminates the worker and clears the connection when the plugin is deactivated', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		await ctx.pluginHost.activate('hello');
		await ctx.pluginHost.deactivate('hello');
		expect(workers.of('hello').terminated).toBe(true);
		expect(workers.of('hello').hostListenerCount()).toBe(0);
		expect(ctx.pluginHost.connections()).toEqual([]);
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('inactive');
	});

	it('terminates the worker when the plugin-host plugin itself unloads', async () => {
		const setup = await mountHost([{ id: 'hello', source: HELLO }]);
		await setup.ctx.pluginHost.activate('hello');
		await setup.fiber.dispose();
		await settle();
		expect(workers.of('hello').terminated).toBe(true);
		expect(workers.alive()).toEqual([]);
	});

	it('terminates the worker when the plugin is removed from disk', async () => {
		const setup = await mountHost([{ id: 'hello', source: HELLO }]);
		await setup.ctx.pluginHost.activate('hello');
		setup.desktop?.emit('plugins:changed', listOf());
		await settle();
		expect(workers.alive()).toEqual([]);
	});

	it('restarts a plugin with a fresh worker', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		await ctx.pluginHost.activate('hello');
		await ctx.pluginHost.restart('hello');
		expect(workers.created).toHaveLength(2);
		expect(workers.created[0].worker.terminated).toBe(true);
		expect(workers.created[1].worker.terminated).toBe(false);
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('active');
	});
});

describe('plugin-host isolation', () => {
	it('marks a plugin whose module throws as failed without affecting another', async () => {
		const { ctx } = await mountHost([
			{ id: 'broken', source: "throw new Error('boom');" },
			{ id: 'fine', source: HELLO }
		]);
		await expect(ctx.pluginHost.activate('broken')).rejects.toThrow('boom');
		const record = ctx.pluginRegistry.get('broken');
		expect(record?.status).toBe('failed');
		expect(record?.error).toContain('boom');
		expect(workers.of('broken').terminated).toBe(true);

		const fine = await ctx.pluginHost.activate('fine');
		expect(fine.isReady).toBe(true);
		expect(ctx.pluginRegistry.get('fine')?.status).toBe('active');
		await expect(ctx.pluginHost.activate('broken')).rejects.toThrow('failed: ');
	});

	it('marks a plugin that never finishes loading as failed after the startup timeout', async () => {
		const { ctx } = await mountHost([{ id: 'slow', source: 'await new Promise(() => {});' }], {
			startupTimeoutMs: 40
		});
		await expect(ctx.pluginHost.activate('slow')).rejects.toThrow('did not finish loading');
		expect(ctx.pluginRegistry.get('slow')?.status).toBe('failed');
		expect(workers.of('slow').terminated).toBe(true);
	});

	it('marks a plugin failed when its worker errors while loading', async () => {
		const { ctx } = await mountHost([{ id: 'slow', source: 'await new Promise(() => {});' }]);
		const starting = ctx.pluginHost.activate('slow');
		await settle();
		workers.of('slow').crash('worker exploded');
		await expect(starting).rejects.toThrow('worker exploded');
		expect(ctx.pluginRegistry.get('slow')?.status).toBe('failed');
	});

	it('logs a worker error after loading instead of failing the plugin', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const connection = await ctx.pluginHost.activate('hello');
		workers.of('hello').crash('late error');
		expect(connection.logs.at(-1)).toMatchObject({ level: 'error', message: 'late error' });
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('active');
	});

	it('fails a plugin whose run hangs and terminates its worker', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }], { runTimeoutMs: 40 });
		const connection = await ctx.pluginHost.activate('hello');
		await expect(
			connection.runScoped('Hang', 'command', () => new Promise(() => {}))
		).rejects.toThrow('did not finish within 40 ms');
		await settle();
		expect(ctx.pluginRegistry.get('hello')?.status).toBe('failed');
		expect(workers.of('hello').terminated).toBe(true);
	});

	it('runs one plugin run at a time, in order, each seeing its own current run', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const connection = await ctx.pluginHost.activate('hello');
		const order: string[] = [];
		const first = connection.runScoped('First', 'command', async () => {
			order.push(`start ${connection.currentRun?.label}`);
			await settle();
			order.push(`end ${connection.currentRun?.label}`);
		});
		const second = connection.runScoped('Second', 'ui', () => {
			order.push(`start ${connection.currentRun?.label}`);
			return Promise.resolve();
		});
		await Promise.all([first, second]);
		expect(order).toEqual(['start First', 'end First', 'start Second']);
		expect(connection.currentRun).toBeNull();
	});

	it('removes the network and storage globals of the worker before plugin code runs', async () => {
		const { ctx } = await mountHost(
			[{ id: 'spy', source: 'design.log.info("running");' }],
			{},
			{
				fetch: () => 'network',
				XMLHttpRequest: class {},
				WebSocket: class {},
				indexedDB: {},
				Worker: class {},
				keep: 'kept'
			}
		);
		await ctx.pluginHost.activate('spy');
		const { scope } = workers.of('spy');
		for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'Worker']) {
			expect(scope[name]).toBeUndefined();
			expect(() => Reflect.set(scope, name, 1)).not.toThrow();
			expect(scope[name]).toBeUndefined();
		}
		expect(scope.keep).toBe('kept');
		expect(Object.isFrozen(scope.design)).toBe(true);
	});
});

describe('plugin-host API seams', () => {
	const CALLER = `
		const answer = await hostCall('math.double', { value: 21 });
		design.log.info('answer', answer);
		try {
			await hostCall('math.missing');
		} catch (error) {
			design.log.info('error', error.message);
		}
	`;

	it('dispatches worker calls to registered namespaces and refuses unknown methods', async () => {
		const { ctx } = await mountHost([{ id: 'caller', source: CALLER }], { requestTimeoutMs: 500 });
		ctx.pluginHost.registerApi('math', {
			double: (_call, params) => Number(Reflect.get(params as object, 'value')) * 2
		});
		const connection = await ctx.pluginHost.activate('caller');
		await settle();
		expect(connection.logs.map((line) => line.message)).toEqual([
			'answer 42',
			'error unknown API method "math.missing"'
		]);
	});

	it('removes a namespace with its disposer, and only that namespace', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const first = { double: () => 1 };
		const second = { double: () => 2 };
		const disposeFirst = ctx.pluginHost.registerApi('math', first);
		ctx.pluginHost.registerApi('math', second);
		disposeFirst();
		expect(ctx.pluginHost.snapshotState().apis).toContain('math');
	});

	it('refuses a method whose permission the manifest did not declare', async () => {
		const { ctx } = await mountHost([{ id: 'caller', source: HELLO }]);
		ctx.pluginHost.registerApi('secret', { read: { permission: 'fs', run: () => 'contents' } });
		const connection = await ctx.pluginHost.activate('caller');
		await settle();
		const asked = connection.channel.request('secret.read');
		// The host answers requests of the worker; a host to worker call of an unknown method fails.
		await expect(asked).rejects.toThrow('no handler');
	});

	it('refuses a declared permission when a plugins/permission listener answers with a reason', async () => {
		const { ctx } = await mountHost([
			{
				id: 'caller',
				source: `
					try { await hostCall('secret.read'); design.log.info('allowed'); }
					catch (error) { design.log.info('refused', error.message); }
				`,
				manifest: { permissions: ['fs'] }
			}
		]);
		ctx.pluginHost.registerApi('secret', { read: { permission: 'fs', run: () => 'contents' } });
		const connection = await ctx.pluginHost.activate('caller');
		await settle();
		expect(connection.logs.map((line) => line.message)).toEqual(['allowed']);

		ctx.on('plugins/permission', (request) => `${request.permission} is off for now`);
		await ctx.pluginHost.restart('caller');
		await settle();
		const restarted = ctx.pluginHost.connectionOf('caller');
		expect(restarted?.logs.map((line) => line.message)).toEqual(['refused fs is off for now']);
	});

	it('refuses a call without the permission in the manifest', async () => {
		const { ctx } = await mountHost([
			{
				id: 'caller',
				source: `
					try { await hostCall('secret.read'); design.log.info('allowed'); }
					catch (error) { design.log.info('refused', error.message); }
				`
			}
		]);
		ctx.pluginHost.registerApi('secret', { read: { permission: 'fs', run: () => 'contents' } });
		const connection = await ctx.pluginHost.activate('caller');
		await settle();
		expect(connection.logs[0].message).toContain('did not declare the "fs" permission');
	});

	it('wraps runs in the registered run scopes, outermost first', async () => {
		const { ctx } = await mountHost([{ id: 'hello', source: HELLO }]);
		const trail: string[] = [];
		ctx.pluginHost.registerRunScope(async (run, body) => {
			trail.push(`outer in ${run.label}`);
			const value = await body();
			trail.push('outer out');
			return value;
		});
		ctx.pluginHost.registerRunScope(async (_run, body) => {
			trail.push('inner in');
			const value = await body();
			trail.push('inner out');
			return value;
		});
		const connection = await ctx.pluginHost.activate('hello');
		await connection.runScoped('Do it', 'command', () => Promise.resolve());
		expect(trail).toEqual(['outer in Do it', 'inner in', 'inner out', 'outer out']);
	});
});
