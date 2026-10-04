import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import {
	pointerEvent,
	pressAt,
	selectionProviders
} from '../../lib/selecting/fixtures/selectionFixture';
import toolMove from '../tool-move';
import selectionCommands from './index';

const BINDINGS: Record<string, string> = {
	enter: 'selection.enter',
	'shift+enter': 'selection.select-parent',
	'\\': 'selection.select-parent',
	tab: 'selection.next-sibling',
	'shift+tab': 'selection.previous-sibling',
	escape: 'selection.deselect',
	'ctrl+a': 'selection.select-all',
	'ctrl+shift+a': 'selection.invert',
	'ctrl+alt+a': 'selection.select-matching'
};

describePlugin('selection-commands', selectionCommands, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		const bound = ctx.keymap.registry
			.listAll()
			.map((binding) => `${binding.chord}>${binding.command}`);
		for (const [chord, command] of Object.entries(BINDINGS)) {
			expect(bound, command).toContain(`${chord}>${command}`);
			expect(ctx.commands.has(command)).toBe(true);
		}
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountCommands(): Promise<Context> {
	mounted = await mountPlugin(selectionCommands, {
		providers: [...selectionProviders(), toolMove]
	});
	return mounted.ctx;
}

function selected(ctx: Context): string[] {
	return [...ctx.selection.ids];
}

describe('selection commands', () => {
	it('Enter selects the children of a group', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['G']);
		await ctx.commands.run('selection.enter');
		expect(selected(ctx)).toEqual(['r1', 'r2']);
	});

	it('Enter asks to edit a text node instead', async () => {
		const ctx = await mountCommands();
		const requests: string[] = [];
		ctx.on('canvas/edit-request', (id, editor) => void requests.push(`${id}:${editor}`));
		ctx.selection.select(['T']);
		await ctx.commands.run('selection.enter');
		expect(requests).toEqual(['T:text']);
		expect(selected(ctx)).toEqual(['T']);
	});

	it('select parent goes up one level and stops at the page', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['r1']);
		await ctx.commands.run('selection.select-parent');
		expect(selected(ctx)).toEqual(['G']);
		await ctx.commands.run('selection.select-parent');
		expect(selected(ctx)).toEqual(['F']);
		await ctx.commands.run('selection.select-parent');
		expect(selected(ctx)).toEqual(['F']);
	});

	it('Tab cycles siblings, Shift+Tab goes back', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['r1']);
		await ctx.commands.run('selection.next-sibling');
		expect(selected(ctx)).toEqual(['r2']);
		await ctx.commands.run('selection.next-sibling');
		expect(selected(ctx)).toEqual(['r1']);
		await ctx.commands.run('selection.previous-sibling');
		expect(selected(ctx)).toEqual(['r2']);
	});

	it('Tab does nothing for a multi selection', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['r1', 'r2']);
		await ctx.commands.run('selection.next-sibling');
		expect(selected(ctx)).toEqual(['r1', 'r2']);
	});

	it('Esc deselects', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['L']);
		await ctx.commands.run('selection.deselect');
		expect(selected(ctx)).toEqual([]);
	});

	it('Esc during a marquee drag aborts it instead of clearing the old selection', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['L']);
		pressAt(ctx, -30, -30);
		ctx.tools.pointerMove(pointerEvent(410, 410));
		await ctx.commands.run('selection.deselect');
		expect(selected(ctx)).toEqual(['L']);
	});

	it('select all takes the selectable nodes at the level of the selection', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['r1']);
		await ctx.commands.run('selection.select-all');
		expect(selected(ctx)).toEqual(['r1', 'r2']);
	});

	it('select all with nothing selected takes the page level, skipping locked and hidden', async () => {
		const ctx = await mountCommands();
		await ctx.commands.run('selection.select-all');
		expect(selected(ctx)).toEqual(['F', 'F2', 'L', 'T']);
	});

	it('invert selects the siblings that were not selected', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['F', 'L']);
		await ctx.commands.run('selection.invert');
		expect(selected(ctx)).toEqual(['F2', 'T']);
	});

	it('select matching picks every node with the same type and style', async () => {
		const ctx = await mountCommands();
		ctx.selection.select(['r1']);
		await ctx.commands.run('selection.select-matching');
		expect(selected(ctx).sort()).toEqual(['inner', 'kid', 'L', 'r1', 'r2'].sort());
	});
});
