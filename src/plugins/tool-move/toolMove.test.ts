import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import {
	clickAt,
	pointerEvent,
	pressAt,
	releaseAt,
	selectionProviders
} from '../../lib/selecting/fixtures/selectionFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import toolMove from './index';

describePlugin('tool-move', toolMove, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('move')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('v');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountMove(): Promise<Context> {
	mounted = await mountPlugin(toolMove, { providers: selectionProviders() });
	return mounted.ctx;
}

function selected(ctx: Context): string[] {
	return [...ctx.selection.ids];
}

// Selection semantics table: what a plain click picks at each scope.
describe('click selection', () => {
	it.each([
		['a group member selects the group', 20, 20, ['G']],
		['a nested frame behaves like a group', 220, 220, ['NF']],
		['a top-level loose node selects itself', 950, 50, ['L']],
		['the empty area of a filled top-level frame selects nothing', 350, 100, []],
		['a child of a second top-level frame selects the child', 540, 40, ['kid']],
		['a locked node is not selectable', 950, 250, []],
		['a hidden node is not hit', 950, 450, []]
	])('%s', async (_name, x, y, expected) => {
		const ctx = await mountMove();
		clickAt(ctx, x, y);
		expect(selected(ctx)).toEqual(expected);
	});

	it('selects a top-level frame through its title label', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 5, -8);
		expect(selected(ctx)).toEqual(['F']);
	});

	it('a click on empty canvas clears the selection and resets the scope', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		ctx.selection.setScope('G');
		clickAt(ctx, 1500, 1500);
		expect(selected(ctx)).toEqual([]);
		expect(ctx.selection.scopeId).toBe('p');
	});

	it('Ctrl/Cmd+click selects the deepest node', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20, { ctrlKey: true });
		expect(selected(ctx)).toEqual(['r1']);
		clickAt(ctx, 220, 220, { metaKey: true });
		expect(selected(ctx)).toEqual(['inner']);
	});

	it('Ctrl+click on a frame’s blank area selects the frame', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 350, 100, { ctrlKey: true });
		expect(selected(ctx)).toEqual(['F']);
	});
});

describe('shift and multi selection', () => {
	it('Shift+click adds and toggles', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		clickAt(ctx, 950, 50, { shiftKey: true });
		expect(selected(ctx)).toEqual(['G', 'L']);
		clickAt(ctx, 950, 50, { shiftKey: true });
		expect(selected(ctx)).toEqual(['G']);
	});

	it('Shift+click on empty canvas keeps the selection', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		clickAt(ctx, 1500, 1500, { shiftKey: true });
		expect(selected(ctx)).toEqual(['G']);
	});

	it('pressing a selected item of a multi selection narrows to it only on release', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		clickAt(ctx, 950, 50, { shiftKey: true });
		pressAt(ctx, 20, 20);
		expect(selected(ctx)).toEqual(['G', 'L']);
		releaseAt(ctx, 20, 20);
		expect(selected(ctx)).toEqual(['G']);
	});
});

describe('double click', () => {
	it('enters the group and the scope follows, repeated double clicks go deeper', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		clickAt(ctx, 20, 20, { detail: 2 });
		expect(selected(ctx)).toEqual(['r1']);
		expect(ctx.selection.scopeId).toBe('G');
	});

	it('enters a nested frame to its child', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 220, 220);
		clickAt(ctx, 220, 220, { detail: 2 });
		expect(selected(ctx)).toEqual(['inner']);
	});

	it('a click outside the entered group selects at page level again', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 20, 20);
		clickAt(ctx, 20, 20, { detail: 2 });
		clickAt(ctx, 950, 50);
		expect(selected(ctx)).toEqual(['L']);
		expect(ctx.selection.scopeId).toBe('p');
	});

	it('asks for text editing on a text node', async () => {
		const ctx = await mountMove();
		const requests: Array<[string, string]> = [];
		ctx.on('canvas/edit-request', (id, editor) => void requests.push([id, editor]));
		clickAt(ctx, 950, 610);
		expect(selected(ctx)).toEqual(['T']);
		clickAt(ctx, 950, 610, { detail: 2 });
		expect(requests).toEqual([['T', 'text']]);
	});
});

describe('hover', () => {
	it('follows the pointer and clears on leave', async () => {
		const ctx = await mountMove();
		ctx.tools.pointerMove(pointerEvent(20, 20));
		expect(ctx.selection.hoverId).toBe('G');
		ctx.tools.pointerMove(pointerEvent(950, 50));
		expect(ctx.selection.hoverId).toBe('L');
		ctx.tools.pointerMove(pointerEvent(1500, 1500));
		expect(ctx.selection.hoverId).toBeNull();
		ctx.tools.pointerMove(pointerEvent(950, 50));
		ctx.tools.pointerLeave();
		expect(ctx.selection.hoverId).toBeNull();
	});
});
