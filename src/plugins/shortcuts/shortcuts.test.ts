import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import shortcuts from './index';

const providers = [coreContextKeys, coreCommands, coreKeymap];

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountShortcuts(): Promise<MountedPlugin> {
	mounted = await mountPlugin(shortcuts, { providers });
	const { ctx } = mounted;
	for (const id of ['tools.activate.frame', 'tools.activate.rectangle', 'tools.activate.image']) {
		ctx.commands.register({ id, title: id, run: () => {} });
	}
	ctx.keymap.register({ key: 'F', command: 'tools.activate.frame', source: 'tool-frame' });
	ctx.keymap.register({ key: 'R', command: 'tools.activate.rectangle', source: 'tool-shapes' });
	return mounted;
}

describePlugin('shortcuts', shortcuts, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.shortcuts.presets().map((preset) => preset.id)).toEqual(['figma', 'penpot']);
		expect(ctx.commands.has('shortcuts.use-penpot-preset')).toBe(true);
	}
});

describe('presets', () => {
	it('switching preset rebinds without a restart', async () => {
		const { ctx } = await mountShortcuts();
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
		ctx.shortcuts.setPreset('penpot');
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('B');
		await ctx.commands.run('shortcuts.use-figma-preset');
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
	});

	it('refuses an unknown preset', async () => {
		const { ctx } = await mountShortcuts();
		expect(() => ctx.shortcuts.setPreset('nope')).toThrow(/unknown shortcut preset/);
	});
});

describe('rebinding and conflicts', () => {
	it('rebinds a command and reports nothing when the chord is free', async () => {
		const { ctx } = await mountShortcuts();
		const result = ctx.shortcuts.rebind('tools.activate.frame', 'G');
		expect(result).toEqual({ applied: true, conflicts: [] });
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('G');
	});

	it('refuses a chord another command uses and names the conflict', async () => {
		const { ctx } = await mountShortcuts();
		const result = ctx.shortcuts.rebind('tools.activate.frame', 'R');
		expect(result.applied).toBe(false);
		expect(result.conflicts.map((binding) => binding.command)).toEqual([
			'tools.activate.rectangle'
		]);
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
	});

	it('replace unbinds the command that held the chord', async () => {
		const { ctx } = await mountShortcuts();
		const result = ctx.shortcuts.rebind('tools.activate.frame', 'R', 'global', {
			onConflict: 'replace'
		});
		expect(result.applied).toBe(true);
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('R');
		expect(ctx.keymap.lookup('tools.activate.rectangle')).toBeUndefined();
		expect(ctx.shortcuts.conflicts()).toEqual([]);
	});

	it('allow lets the override shadow the default without a reported conflict', async () => {
		const { ctx } = await mountShortcuts();
		ctx.shortcuts.rebind('tools.activate.frame', 'R', 'global', { onConflict: 'allow' });
		expect(ctx.shortcuts.conflicts()).toEqual([]);
		expect(ctx.keymap.bindings()[0].command).toBe('tools.activate.frame');
	});

	it('two user overrides on one chord are reported', async () => {
		const { ctx } = await mountShortcuts();
		ctx.shortcuts.rebind('tools.activate.frame', 'G', 'global', { onConflict: 'allow' });
		ctx.shortcuts.rebind('tools.activate.rectangle', 'G', 'global', { onConflict: 'allow' });
		const conflicts = ctx.shortcuts.conflicts();
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].chord).toBe('g');
	});

	it('reset brings the preset binding back', async () => {
		const { ctx } = await mountShortcuts();
		ctx.shortcuts.rebind('tools.activate.frame', 'G');
		ctx.shortcuts.reset('tools.activate.frame');
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
	});
});

describe('export and import', () => {
	it('round trips the preset and overrides as JSON', async () => {
		const { ctx } = await mountShortcuts();
		ctx.shortcuts.setPreset('penpot');
		ctx.shortcuts.rebind('tools.activate.rectangle', 'Mod+Shift+R');
		const text = ctx.shortcuts.exportOverrides();
		ctx.shortcuts.resetAll();
		ctx.shortcuts.setPreset('figma');
		expect(ctx.keymap.lookup('tools.activate.rectangle')).toBe('R');

		ctx.shortcuts.importOverrides(text);
		expect(ctx.shortcuts.preset).toBe('penpot');
		expect(ctx.keymap.lookup('tools.activate.rectangle')).toBe('Ctrl+Shift+R');
	});

	it('rejects malformed input without changing anything', async () => {
		const { ctx } = await mountShortcuts();
		expect(() => ctx.shortcuts.importOverrides('{')).toThrow(/not valid JSON/);
		expect(() => ctx.shortcuts.importOverrides('{"preset":1}')).toThrow(/malformed/);
		expect(() =>
			ctx.shortcuts.importOverrides(
				'{"preset":"penpot","overrides":[{"scope":"global","command":"x","key":"Mod+Nope"}]}'
			)
		).toThrow(/chord/);
		expect(ctx.shortcuts.preset).toBe('figma');
	});
});
