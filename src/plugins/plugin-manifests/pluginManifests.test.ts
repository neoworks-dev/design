import { describe, expect, it } from 'vitest';
import type { PluginList } from '../../../electron/bridge';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginProviders,
	validManifest
} from '../../lib/plugins/fixtures/pluginFixture';
import type { PluginRuntime } from '../../lib/plugins/types';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import pluginManifests from './index';

const FULL = validManifest({
	contributes: {
		commands: [{ id: 'example.hello', title: 'Say hello' }],
		menus: [{ menu: 'app/plugins', id: 'example.hello', command: 'example.hello' }],
		keybindings: [{ key: 'Mod+Shift+H', command: 'example.hello' }],
		tools: [{ id: 'example.brush', title: 'Brush' }],
		aiTools: [{ id: 'example_count', description: 'Count', write: false }]
	}
});

let current = listOf(discovered(FULL));
const section = fakePluginsSection(() => current);

async function mountManifests(list: PluginList): Promise<MountedPlugin> {
	current = list;
	const mounted = await mountPlugin(pluginManifests, {
		providers: pluginProviders(),
		desktop: { plugins: section }
	});
	await settle();
	return mounted;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

function fakeRuntime(): PluginRuntime & { commands: string[]; activations: string[] } {
	const commands: string[] = [];
	const activations: string[] = [];
	return {
		commands,
		activations,
		activate: (id) => {
			activations.push(id);
			return Promise.resolve();
		},
		runCommand: (id, commandId) => {
			activations.push(id);
			commands.push(commandId);
			return Promise.resolve();
		},
		call: () => Promise.resolve('ok'),
		notify: () => {}
	};
}

describePlugin('plugin-manifests', pluginManifests, {
	providers: pluginProviders(),
	desktop: { plugins: section },
	contributes: async ({ ctx }) => {
		await settle();
		expect(ctx.pluginRegistry).toBeDefined();
		expect(ctx.pluginRegistry.get('example')?.status).toBe('inactive');
		expect(ctx.commands.has('example.hello')).toBe(true);
	}
});

describe('plugin-manifests', () => {
	it('registers every contribution kind as a stub through the ordinary services', async () => {
		const { ctx, cleanup } = await mountManifests(listOf(discovered(FULL)));
		try {
			expect(ctx.commands.has('example.hello')).toBe(true);
			expect(ctx.menus.resolve('app/plugins').map((item) => item.id)).toContain('example.hello');
			expect(ctx.keymap.registry.listAll().map((binding) => binding.command)).toContain(
				'example.hello'
			);
			expect(ctx.tools.registry.has('example.brush')).toBe(true);
			expect(ctx.ai.tools.has('example_count')).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('does not start the worker for a stub command until its first run', async () => {
		const { ctx, cleanup } = await mountManifests(listOf(discovered(FULL)));
		try {
			const runtime = fakeRuntime();
			ctx.pluginRegistry.setRuntime(runtime);
			expect(runtime.activations).toEqual([]);
			await ctx.commands.run('example.hello');
			expect(runtime.commands).toEqual(['example.hello']);
			expect(runtime.activations).toEqual(['example']);
		} finally {
			await cleanup();
		}
	});

	it('fails a stub command with a clear error while no plugin host is loaded', async () => {
		const { ctx, cleanup } = await mountManifests(listOf(discovered(FULL)));
		try {
			await expect(ctx.commands.run('example.hello')).rejects.toThrow('plugin host is not loaded');
		} finally {
			await cleanup();
		}
	});

	it('rejects an invalid manifest with path-level errors and registers nothing', async () => {
		const broken = validManifest({ contributes: { commands: [{ id: 'nope.run', title: 'Run' }] } });
		const { ctx, cleanup } = await mountManifests(listOf(discovered(broken)));
		try {
			const [record] = ctx.pluginRegistry.records();
			expect(record.status).toBe('invalid');
			expect(record.errors[0].path).toBe('contributes.commands[0].id');
			expect(ctx.commands.has('nope.run')).toBe(false);
		} finally {
			await cleanup();
		}
	});

	it('lists a plugin for a newer API as incompatible and does not mount it', async () => {
		const future = validManifest({ api: '9.0' });
		const { ctx, cleanup } = await mountManifests(listOf(discovered(future)));
		try {
			const record = ctx.pluginRegistry.get('example');
			expect(record?.status).toBe('incompatible');
			expect(record?.error).toContain('9.0');
			expect(ctx.commands.has('example.hello')).toBe(false);
		} finally {
			await cleanup();
		}
	});

	it('lists an untrusted project plugin without mounting its stubs', async () => {
		const { ctx, cleanup } = await mountManifests(
			listOf(discovered(FULL, { source: 'project', trusted: false }))
		);
		try {
			expect(ctx.pluginRegistry.get('example')?.status).toBe('untrusted');
			expect(ctx.commands.has('example.hello')).toBe(false);
		} finally {
			await cleanup();
		}
	});

	it('keeps the first plugin of an id and marks later ones shadowed', async () => {
		const { ctx, cleanup } = await mountManifests(
			listOf(
				discovered(FULL, { source: 'builtin', directoryName: 'first' }),
				discovered(FULL, { source: 'user', directoryName: 'second' })
			)
		);
		try {
			expect(ctx.pluginRegistry.records().map((record) => record.status)).toEqual([
				'inactive',
				'shadowed'
			]);
		} finally {
			await cleanup();
		}
	});

	it('follows plugins:changed: adds, replaces and removes stubs', async () => {
		const mounted = await mountManifests(listOf(discovered(FULL)));
		const { ctx, desktop, cleanup } = mounted;
		try {
			const renamed = validManifest({
				contributes: { commands: [{ id: 'example.other', title: 'Other' }] }
			});
			desktop?.emit('plugins:changed', listOf(discovered(renamed)));
			await settle();
			expect(ctx.commands.has('example.hello')).toBe(false);
			expect(ctx.commands.has('example.other')).toBe(true);

			desktop?.emit('plugins:changed', listOf());
			await settle();
			expect(ctx.commands.has('example.other')).toBe(false);
			expect(ctx.pluginRegistry.records()).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	it('mounts several plugins side by side', async () => {
		const second = validManifest({
			id: 'second',
			contributes: { commands: [{ id: 'second.run', title: 'Run' }] }
		});
		const mounted = await mountManifests(
			listOf(discovered(FULL), discovered(second, { directoryName: 'second' }))
		);
		try {
			expect(mounted.ctx.commands.has('example.hello')).toBe(true);
			expect(mounted.ctx.commands.has('second.run')).toBe(true);
		} finally {
			await mounted.cleanup();
		}
	});
});
