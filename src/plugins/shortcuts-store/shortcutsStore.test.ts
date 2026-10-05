import type { Plugin } from '@neoworks/extension-system';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import shortcuts from '../shortcuts';
import shortcutsStore from './index';

const providers = [coreContextKeys, coreCommands, coreKeymap, shortcuts];

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountStore(config: unknown = {}): Promise<MountedPlugin> {
	mounted = await mountPlugin(shortcutsStore, { providers, config });
	const { ctx } = mounted;
	for (const id of ['tools.activate.frame', 'tools.activate.rectangle', 'tools.activate.image']) {
		ctx.commands.register({ id, title: id, run: () => {} });
	}
	ctx.keymap.register({ key: 'F', command: 'tools.activate.frame', source: 'tool-frame' });
	ctx.keymap.register({ key: 'R', command: 'tools.activate.rectangle', source: 'tool-shapes' });
	return mounted;
}

async function settleConfigUpdate(): Promise<void> {
	flushSync();
	for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describePlugin('shortcuts-store', shortcutsStore, {
	providers,
	contributes: ({ fiber }) => {
		expect(fiber.config).toEqual({ preset: 'figma', overrides: [] });
	}
});

describe('persistence through the plugin config', () => {
	it('a change updates the plugin config, which the settings store persists', async () => {
		const first = await mountStore();
		first.ctx.shortcuts.rebind('tools.activate.frame', 'G');
		first.ctx.shortcuts.setPreset('penpot');
		await settleConfigUpdate();
		expect(first.fiber.config.preset).toBe('penpot');
		expect(first.fiber.config.overrides).toEqual([
			{ scope: 'global', command: 'tools.activate.frame', key: 'G' }
		]);
		// the restart that stored it applied it again
		expect(first.ctx.shortcuts.preset).toBe('penpot');
		expect(first.ctx.keymap.lookup('tools.activate.frame')).toBe('G');
	});

	it('restarting the store does not restart the shortcuts service or its dependents', async () => {
		const first = await mountStore();
		let starts = 0;
		const dependent: Plugin = {
			name: 'dependent',
			inject: ['shortcuts'],
			apply: () => void (starts += 1)
		} as Plugin;
		await first.ctx.plugin(dependent);
		first.ctx.shortcuts.rebind('tools.activate.frame', 'G');
		await settleConfigUpdate();
		first.ctx.shortcuts.rebind('tools.activate.rectangle', 'H');
		await settleConfigUpdate();
		expect(first.fiber.config.overrides).toHaveLength(2);
		expect(starts).toBe(1);
	});

	it('overrides and preset survive a restart', async () => {
		const first = await mountStore();
		first.ctx.shortcuts.rebind('tools.activate.frame', 'G');
		first.ctx.shortcuts.setPreset('penpot');
		await settleConfigUpdate();
		const stored = first.fiber.config;
		await first.cleanup();
		mounted = undefined;

		const second = await mountStore(stored);
		expect(second.ctx.shortcuts.preset).toBe('penpot');
		expect(second.ctx.keymap.lookup('tools.activate.frame')).toBe('G');
		expect(second.ctx.keymap.lookup('tools.activate.image')).toBe('K');
		second.ctx.shortcuts.reset('tools.activate.frame');
		expect(second.ctx.keymap.lookup('tools.activate.frame')).toBe('B');
	});

	it('ignores malformed stored overrides and an unknown preset', async () => {
		const { ctx } = await mountStore({ preset: 'nope', overrides: ['junk', 3, { scope: 1 }] });
		expect(ctx.shortcuts.preset).toBe('figma');
		expect(ctx.shortcuts.overrides()).toEqual([]);
	});

	it('does not touch localStorage', async () => {
		const before = globalThis.localStorage.length;
		const { ctx } = await mountStore();
		ctx.shortcuts.rebind('tools.activate.frame', 'G');
		await settleConfigUpdate();
		expect(globalThis.localStorage.length).toBe(before);
	});
});
