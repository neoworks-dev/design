import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { KeyEventLike } from '../../lib/registries/chord';
import { categoryOf, groupRows, rowMatches } from '../../lib/shortcuts/rows';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import shortcuts from '../shortcuts';
import shortcutsPanel from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreMenus, shortcuts];

let mounted: MountedPlugin | undefined;
const ran: string[] = [];

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	ran.length = 0;
});

function press(key: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}): KeyEventLike {
	return {
		key,
		code: `Key${key.toUpperCase()}`,
		ctrlKey: modifiers.ctrl === true,
		metaKey: false,
		altKey: false,
		shiftKey: modifiers.shift === true
	};
}

async function mountPanel(): Promise<MountedPlugin> {
	mounted = await mountPlugin(shortcutsPanel, { providers });
	const { ctx } = mounted;
	for (const id of ['tools.activate.frame', 'tools.activate.rectangle', 'view.zoom-in']) {
		ctx.commands.register({ id, title: id.replace(/.*\./, ''), run: () => void ran.push(id) });
	}
	ctx.keymap.register({ key: 'F', command: 'tools.activate.frame', source: 'tool-frame' });
	ctx.keymap.register({ key: 'R', command: 'tools.activate.rectangle', source: 'tool-shapes' });
	return mounted;
}

describePlugin('shortcuts-panel', shortcutsPanel, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('shortcuts-panel.toggle')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+shift+/');
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'shortcuts-panel/dialog'
		);
	}
});

describe('the panel service', () => {
	it('opens with its command and closes with a reset search', async () => {
		const { ctx } = await mountPanel();
		await ctx.commands.run('shortcuts-panel.toggle');
		expect(ctx.shortcutsPanel.isOpen).toBe(true);
		ctx.shortcutsPanel.setQuery('zoom');
		ctx.shortcutsPanel.close();
		expect(ctx.shortcutsPanel.isOpen).toBe(false);
		expect(ctx.shortcutsPanel.query).toBe('');
	});

	it('lists every command with its chord and source, grouped by category', async () => {
		const { ctx } = await mountPanel();
		const groups = ctx.shortcutsPanel.groups();
		const tools = groups.find((group) => group.category === 'Tools');
		const frame = tools?.rows.find((row) => row.commandId === 'tools.activate.frame');
		expect(frame?.bindings).toMatchObject([
			{ display: 'F', scope: 'global', source: 'tool-frame' }
		]);
		const zoom = groups.find((group) => group.category === 'View')?.rows[0];
		expect(zoom?.bindings).toEqual([]);
	});

	it('searches by title, id and chord', async () => {
		const { ctx } = await mountPanel();
		const found = (query: string): string[] => {
			ctx.shortcutsPanel.setQuery(query);
			return ctx.shortcutsPanel.groups().flatMap((group) => group.rows.map((row) => row.commandId));
		};
		expect(found('rect')).toEqual(['tools.activate.rectangle']);
		expect(found('view.')).toEqual(['view.zoom-in']);
		expect(found('f')).toContain('tools.activate.frame');
		expect(found('nothing matches this')).toEqual([]);
	});

	it('recording a key rebinds at once: the new key runs the command, the old one does not', async () => {
		const { ctx } = await mountPanel();
		const panel = ctx.shortcutsPanel;
		panel.startRecording('tools.activate.frame');
		expect(panel.recordEvent(press('g'))).toBe(true);
		expect(panel.recording).toBeNull();
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('G');
		ctx.keymap.handleKeydown(press('g'));
		ctx.keymap.handleKeydown(press('f'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ran).toEqual(['tools.activate.frame']);
		const row = panel
			.groups()
			.flatMap((group) => group.rows)
			.find((entry) => entry.commandId === 'tools.activate.frame');
		expect(row?.modified).toBe(true);
		expect(row?.bindings[0]).toMatchObject({ source: 'Custom', custom: true });
	});

	it('ignores a lone modifier and cancels on Escape', async () => {
		const { ctx } = await mountPanel();
		const panel = ctx.shortcutsPanel;
		panel.startRecording('view.zoom-in');
		panel.recordEvent({ ...press('Shift'), key: 'Shift', code: 'ShiftLeft' });
		expect(panel.recording).not.toBeNull();
		panel.recordEvent({ ...press('x'), key: 'Escape', code: 'Escape' });
		expect(panel.recording).toBeNull();
		expect(ctx.keymap.lookup('view.zoom-in')).toBeUndefined();
	});

	it('a chord another command uses asks first, and Replace takes it over', async () => {
		const { ctx } = await mountPanel();
		const panel = ctx.shortcutsPanel;
		panel.startRecording('tools.activate.frame');
		panel.recordEvent(press('r'));
		expect(panel.conflict).toMatchObject({
			commandId: 'tools.activate.frame',
			holders: ['rectangle']
		});
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');

		panel.confirmReplace();
		expect(panel.conflict).toBeNull();
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('R');
		expect(ctx.keymap.lookup('tools.activate.rectangle')).toBeUndefined();
	});

	it('cancelling a clash changes nothing', async () => {
		const { ctx } = await mountPanel();
		const panel = ctx.shortcutsPanel;
		panel.startRecording('tools.activate.frame');
		panel.recordEvent(press('r'));
		panel.cancelRecording();
		expect(panel.conflict).toBeNull();
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
		expect(ctx.keymap.lookup('tools.activate.rectangle')).toBe('R');
	});

	it('unbinds, resets one command and resets all', async () => {
		const { ctx } = await mountPanel();
		const panel = ctx.shortcutsPanel;
		panel.unbind('tools.activate.frame', 'global');
		expect(ctx.keymap.lookup('tools.activate.frame')).toBeUndefined();
		panel.reset('tools.activate.frame');
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');

		panel.bind('tools.activate.frame', 'G', 'global');
		panel.bind('view.zoom-in', 'Z', 'global');
		expect(panel.hasOverrides).toBe(true);
		panel.resetAll();
		flushSync();
		expect(panel.hasOverrides).toBe(false);
		expect(ctx.keymap.lookup('tools.activate.frame')).toBe('F');
		expect(ctx.keymap.lookup('view.zoom-in')).toBeUndefined();
	});

	it('switches the preset through the shortcuts service', async () => {
		const { ctx } = await mountPanel();
		expect(ctx.shortcutsPanel.presets.map((preset) => preset.id)).toContain('penpot');
		ctx.shortcutsPanel.setPreset('penpot');
		expect(ctx.shortcutsPanel.preset).toBe('penpot');
	});
});

describe('row helpers', () => {
	it('derives the category from the command id prefix', () => {
		expect(categoryOf('tools.activate.frame')).toBe('Tools');
		expect(categoryOf('workbench-layout.toggle-ui')).toBe('Workbench layout');
	});

	it('matches a chord ignoring case and spaces, and groups in first-seen order', () => {
		const row = {
			commandId: 'a.b',
			title: 'Thing',
			category: 'A',
			modified: false,
			bindings: [
				{
					scope: 'global',
					chord: 'ctrl+shift+k',
					display: 'Ctrl+Shift+K',
					source: 'x',
					custom: false
				}
			]
		};
		expect(rowMatches(row, 'ctrl + shift')).toBe(true);
		expect(rowMatches(row, 'CTRL+SHIFT+K')).toBe(true);
		expect(rowMatches(row, 'alt')).toBe(false);
		const other = { ...row, commandId: 'z.y', category: 'Z' };
		expect(
			groupRows([other, row, { ...other, commandId: 'z.x' }]).map((group) => group.category)
		).toEqual(['Z', 'A']);
	});
});
