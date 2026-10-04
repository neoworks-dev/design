import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import historyPlugin from '../../plugins/history';
import selectionPlugin from '../../plugins/selection';
import { createNode, type ApplyMeta, type Change } from '../document';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import type { DocumentService } from './document';
import { documentWith, sampleDocument } from './fixtures/documentFixture';
import { HistoryError } from './history';

function providers(): Plugin[] {
	return [
		coreContextKeys,
		coreCommands,
		{ ...coreKeymap, apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' }) },
		documentWith(sampleDocument()),
		selectionPlugin
	];
}

describePlugin('history', historyPlugin, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('edit.undo')).toBe(true);
		expect(ctx.commands.has('edit.redo')).toBe(true);
		expect(ctx.history.canUndo).toBe(false);
		expect(ctx.contextKeys.get('canUndo')).toBe(false);
		const chords = ctx.keymap.registry
			.listAll()
			.map((binding) => `${binding.chord}>${binding.command}`);
		expect(chords).toContain('ctrl+z>edit.undo');
		expect(chords).toContain('ctrl+shift+z>edit.redo');
		expect(chords).toContain('ctrl+y>edit.redo');
	}
});

const user: ApplyMeta = { origin: 'user', label: 'Edit' };

interface Clock {
	time: number;
}

async function mount(
	clock: Clock = { time: 0 },
	options: { limit?: number } = {}
): Promise<MountedPlugin> {
	return mountPlugin(historyPlugin, {
		providers: providers(),
		config: { now: () => clock.time, ...options }
	});
}

/** Order-independent picture of the whole document including sibling order. */
function canonical(document: DocumentService): string {
	const ids = Object.keys(document.snapshot.nodes).sort();
	const order = [null, ...ids].map((id) => [id, [...document.children(id)]]);
	return JSON.stringify({ nodes: ids.map((id) => document.snapshot.nodes[id]), order });
}

function nudge(document: DocumentService, id: string, x: number, key = `nudge:${id}`): void {
	document.apply(
		document.setProps(id, {
			transform: [
				[1, 0, x],
				[0, 1, 0]
			]
		}),
		{ origin: 'user', label: 'Nudge', mergeKey: key }
	);
}

describe('undo and redo round trips', () => {
	it('move, resize, delete and group', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		const initial = canonical(document);

		document.apply(document.moveNode('n3', 'n5', 0), { origin: 'user', label: 'Move' });
		const afterMove = canonical(document);
		document.apply(document.setProps('n4', { width: 321, height: 123 }), {
			origin: 'user',
			label: 'Resize'
		});
		const afterResize = canonical(document);
		document.apply(document.removeNode('n5'), { origin: 'user', label: 'Delete' });
		const afterDelete = canonical(document);
		const wrapper = createNode('GROUP', { id: 'grp', parentId: 'n2', index: 'a9' });
		document.apply(
			[
				...document.insertNode(wrapper),
				{ t: 'move', id: 'n4', parent: 'grp', index: 'a0', prevParent: 'n2', prevIndex: 'a1' }
			],
			{
				origin: 'user',
				label: 'Group'
			}
		);
		const afterGroup = canonical(document);

		expect(history.entries.map((entry) => entry.label)).toEqual([
			'Move',
			'Resize',
			'Delete',
			'Group'
		]);
		expect(history.undoLabel).toBe('Group');

		expect(history.undo()).toBe(true);
		expect(canonical(document)).toBe(afterDelete);
		expect(history.undo()).toBe(true);
		expect(canonical(document)).toBe(afterResize);
		expect(history.undo()).toBe(true);
		expect(canonical(document)).toBe(afterMove);
		expect(history.undo()).toBe(true);
		expect(canonical(document)).toBe(initial);
		expect(history.undo()).toBe(false);

		expect(history.redo()).toBe(true);
		expect(canonical(document)).toBe(afterMove);
		history.redo();
		history.redo();
		history.redo();
		expect(canonical(document)).toBe(afterGroup);
		expect(history.redo()).toBe(false);
		await cleanup();
	});

	it('a new transaction clears redo', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		document.apply(document.setProps('n3', { name: 'a' }), user);
		history.undo();
		expect(history.canRedo).toBe(true);
		document.apply(document.setProps('n3', { name: 'b' }), user);
		expect(history.canRedo).toBe(false);
		expect(history.redo()).toBe(false);
		await cleanup();
	});

	it('does not record its own replay', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		document.apply(document.setProps('n3', { name: 'a' }), user);
		history.undo();
		history.redo();
		expect(history.entries).toHaveLength(1);
		await cleanup();
	});

	it('one undo covers derived changes appended to the transaction', async () => {
		const { ctx, cleanup } = await mount();
		await ctx.plugin({
			name: 'fake-reflow',
			inject: ['document'],
			apply(inner: Context): void {
				inner.on('document/append', ({ changes }, next) => {
					const derived: Change[] = [];
					for (const change of changes) {
						if (change.t !== 'set' || !('width' in change.set)) continue;
						for (const childId of inner.document.children(change.id)) {
							derived.push({ t: 'set', id: childId, set: { width: change.set.width }, prev: {} });
						}
					}
					return [...next(), ...derived];
				});
			}
		});
		const { document, history } = ctx;
		const before = canonical(document);
		document.apply(document.setProps('n2', { width: 400 }), user);
		expect(document.get('n3')).toMatchObject({ width: 400 });
		expect(history.entries).toHaveLength(1);
		history.undo();
		expect(canonical(document)).toBe(before);
		await cleanup();
	});

	it('clears the history and throws when the document no longer matches an entry', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		document.apply(document.setProps('n3', { name: 'a' }), user);
		document.apply(document.removeNode('n3'), { ...user, replay: 'redo' });
		expect(() => history.undo()).toThrow(HistoryError);
		expect(history.canUndo).toBe(false);
		expect(history.entries).toEqual([]);
		await cleanup();
	});
});

describe('coalescing', () => {
	it('rapid nudges with one mergeKey become one entry that undoes to the start', async () => {
		const clock = { time: 0 };
		const { ctx, cleanup } = await mount(clock);
		const { document, history } = ctx;
		const initial = canonical(document);
		for (let step = 1; step <= 5; step += 1) {
			clock.time += 100;
			nudge(document, 'n3', step);
		}
		expect(history.entries).toHaveLength(1);
		expect(history.entries[0].transactionCount).toBe(5);
		expect(document.get('n3')).toMatchObject({
			transform: [
				[1, 0, 5],
				[0, 1, 0]
			]
		});
		history.undo();
		expect(canonical(document)).toBe(initial);
		history.redo();
		expect(document.get('n3')).toMatchObject({
			transform: [
				[1, 0, 5],
				[0, 1, 0]
			]
		});
		await cleanup();
	});

	it('a pause longer than the window starts a new entry', async () => {
		const clock = { time: 0 };
		const { ctx, cleanup } = await mount(clock);
		const { document, history } = ctx;
		nudge(document, 'n3', 1);
		clock.time += 200;
		nudge(document, 'n3', 2);
		clock.time += 5000;
		nudge(document, 'n3', 3);
		expect(history.entries).toHaveLength(2);
		await cleanup();
	});

	it('different keys and entries without a key never merge', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		nudge(document, 'n3', 1);
		nudge(document, 'n4', 1);
		document.apply(document.setProps('n4', { name: 'a' }), user);
		document.apply(document.setProps('n4', { name: 'b' }), user);
		expect(history.entries).toHaveLength(4);
		await cleanup();
	});
});

describe('groups', () => {
	it('a gesture is one entry and undo is unavailable while it is open', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		const initial = canonical(document);
		document.apply(document.setProps('n4', { name: 'earlier' }), user);
		const handle = history.beginGroup({ label: 'Drag' });
		for (let x = 1; x <= 10; x += 1) {
			document.apply(
				document.setProps('n3', {
					transform: [
						[1, 0, x * 10],
						[0, 1, 0]
					]
				}),
				{ origin: 'user', label: 'drag step' }
			);
		}
		expect(history.canUndo).toBe(false);
		expect(history.undo()).toBe(false);
		history.endGroup(handle);
		history.endGroup(handle);
		expect(history.entries.map((entry) => entry.label)).toEqual(['Edit', 'Drag']);
		expect(history.entries[1].transactionCount).toBe(10);
		history.undo();
		expect(document.get('n3')).toMatchObject({
			transform: [
				[1, 0, 0],
				[0, 1, 0]
			]
		});
		history.undo();
		expect(canonical(document)).toBe(initial);
		await cleanup();
	});

	it('an async run with a runId is one step; other transactions stay separate', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		const initial = canonical(document);
		await history.group({ label: 'AI: rename layers', origin: 'ai', runId: 'run-1' }, async () => {
			const meta: ApplyMeta = { origin: 'ai', label: 'rename', runId: 'run-1' };
			document.apply(document.setProps('n3', { name: 'Header' }), meta);
			await Promise.resolve();
			document.apply(document.setProps('n4', { name: 'Footer' }), meta);
			document.apply(document.setProps('n6', { name: 'Body' }), { ...user, label: 'user edit' });
			await Promise.resolve();
			document.apply(document.setProps('n5', { name: 'Card' }), meta);
		});
		expect(history.entries.map((entry) => `${entry.label}:${entry.origin}`)).toEqual([
			'user edit:user',
			'AI: rename layers:ai'
		]);
		expect(history.entries[1]).toMatchObject({ transactionCount: 3, runId: 'run-1' });
		history.undo();
		expect(document.get('n3')).toMatchObject({ name: 'R1' });
		expect(document.get('n4')).toMatchObject({ name: 'R2' });
		expect(document.get('n5')).toMatchObject({ name: 'G' });
		expect(document.get('n6')).toMatchObject({ name: 'Body' });
		history.undo();
		expect(canonical(document)).toBe(initial);
		await cleanup();
	});

	it('a run that throws keeps what it applied as one undoable step', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		const initial = canonical(document);
		await expect(
			history.group({ label: 'Plugin run', origin: 'plugin' }, () => {
				document.apply(document.setProps('n3', { name: 'x' }), { origin: 'plugin', label: 'a' });
				document.apply(document.setProps('n4', { name: 'y' }), { origin: 'plugin', label: 'b' });
				throw new Error('plugin crashed');
			})
		).rejects.toThrow('plugin crashed');
		expect(history.entries).toHaveLength(1);
		history.undo();
		expect(canonical(document)).toBe(initial);
		await cleanup();
	});

	it('nested groups join the outer one; an empty group leaves no entry', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		await history.group({ label: 'Outer' }, async () => {
			await history.group({ label: 'Inner' }, () => {
				document.apply(document.setProps('n3', { name: 'x' }), user);
			});
			document.apply(document.setProps('n4', { name: 'y' }), user);
		});
		await history.group({ label: 'Nothing' }, () => undefined);
		expect(history.entries.map((entry) => entry.label)).toEqual(['Outer']);
		await cleanup();
	});
});

describe('selection', () => {
	it('undo restores the selection as it was, redo the one at undo time', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history, selection } = ctx;
		selection.select(['n3', 'n4']);
		document.apply(document.removeNode('n3'), { origin: 'user', label: 'Delete' });
		expect(selection.ids).toEqual(['n4']);
		selection.select(['n6']);

		history.undo();
		expect(document.has('n3')).toBe(true);
		expect(selection.ids).toEqual(['n3', 'n4']);

		history.redo();
		expect(document.has('n3')).toBe(false);
		expect(selection.ids).toEqual(['n6']);
		await cleanup();
	});

	it('selection changes themselves are not in the stack', async () => {
		const { ctx, cleanup } = await mount();
		ctx.selection.select(['n3']);
		ctx.selection.clear();
		expect(ctx.history.entries).toEqual([]);
		await cleanup();
	});
});

describe('limits, replace and commands', () => {
	it('keeps at most `limit` entries, dropping the oldest', async () => {
		const { ctx, cleanup } = await mount({ time: 0 }, { limit: 3 });
		const { document, history } = ctx;
		for (let step = 1; step <= 5; step += 1) {
			document.apply(document.setProps('n3', { name: `v${step}` }), {
				origin: 'user',
				label: `edit ${step}`
			});
		}
		expect(history.entries.map((entry) => entry.label)).toEqual(['edit 3', 'edit 4', 'edit 5']);
		history.setLimit(2);
		expect(history.entries.map((entry) => entry.label)).toEqual(['edit 4', 'edit 5']);
		expect(() => history.setLimit(0)).toThrow(RangeError);
		await cleanup();
	});

	it('replacing the document drops the history', async () => {
		const { ctx, cleanup } = await mount();
		const { document, history } = ctx;
		document.apply(document.setProps('n3', { name: 'a' }), user);
		document.replaceDocument(sampleDocument());
		expect(history.entries).toEqual([]);
		expect(history.canUndo).toBe(false);
		await cleanup();
	});

	it('edit.undo and edit.redo run through commands and follow canUndo / canRedo', async () => {
		const { ctx, cleanup } = await mount();
		const { document, commands, contextKeys } = ctx;
		await expect(commands.run('edit.undo')).rejects.toThrow(/disabled/);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		expect(contextKeys.get('canUndo')).toBe(true);
		expect(contextKeys.get('canRedo')).toBe(false);
		await commands.run('edit.undo');
		expect(document.get('n3')).toMatchObject({ name: 'R1' });
		expect(contextKeys.get('canUndo')).toBe(false);
		expect(contextKeys.get('canRedo')).toBe(true);
		await commands.run('edit.redo');
		expect(document.get('n3')).toMatchObject({ name: 'a' });
		await cleanup();
	});

	it('Ctrl+Z and Ctrl+Shift+Z undo and redo through the keymap', async () => {
		const { ctx, cleanup } = await mount();
		const { document, keymap } = ctx;
		document.apply(document.setProps('n3', { name: 'a' }), user);
		const event = (key: string, shiftKey: boolean): Parameters<typeof keymap.handleKeydown>[0] => ({
			key,
			code: `Key${key.toUpperCase()}`,
			ctrlKey: true,
			metaKey: false,
			altKey: false,
			shiftKey,
			repeat: false,
			target: null,
			preventDefault: () => undefined
		});
		expect(keymap.handleKeydown(event('z', false))).toBe(true);
		expect(document.get('n3')).toMatchObject({ name: 'R1' });
		expect(keymap.handleKeydown(event('z', true))).toBe(true);
		expect(document.get('n3')).toMatchObject({ name: 'a' });
		await cleanup();
	});

	it('announces stack changes with history/change', async () => {
		const { ctx, cleanup } = await mount();
		let announcements = 0;
		ctx.on('history/change', () => (announcements += 1));
		ctx.document.apply(ctx.document.setProps('n3', { name: 'a' }), user);
		ctx.history.undo();
		expect(announcements).toBe(2);
		await cleanup();
	});
});
