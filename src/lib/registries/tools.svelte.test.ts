import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import coreRegions from '../../plugins/core-regions';
import coreTools from '../../plugins/core-tools';
import PlaceholderText from '../../plugins/placeholder-shell/PlaceholderText.svelte';
import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
import HostRoot from '../kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import type { ToolKeyEvent, ToolPointerEvent } from '../tools/protocol';
import { UnknownToolError, type ToolContribution } from './tools.svelte';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreTools];

let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
let mounted: MountedPlugin | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountTools(): Promise<MountedPlugin> {
	const consumer = {
		name: 'consumer',
		inject: ['tools', 'commands', 'keymap', 'contextKeys'],
		apply(): void {}
	};
	mounted = await mountPlugin(consumer, { providers });
	return mounted;
}

function pointer(x = 0, y = 0): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false
	};
}

function keyEvent(key: string): ToolKeyEvent {
	return {
		key,
		code: key,
		repeat: false,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		preventDefault: () => {}
	};
}

function recordingTool(
	id: string,
	log: string[],
	extra: Partial<ToolContribution> = {}
): ToolContribution {
	return {
		id,
		title: id,
		icon: SquareIcon,
		onActivate: () => void log.push(`${id}:activate`),
		onDeactivate: () => void log.push(`${id}:deactivate`),
		...extra
	};
}

describe('tools registration', () => {
	it('a tool adds its command, shortcut and toolbar entry; dispose removes all of them', async () => {
		const { ctx } = await mountTools();
		const dispose = ctx.tools.register({
			id: 'rectangle',
			title: 'Rectangle',
			icon: SquareIcon,
			shortcut: 'R'
		});
		expect(ctx.commands.has('tools.activate.rectangle')).toBe(true);
		expect(ctx.keymap.lookupChords('tools.activate.rectangle')).toEqual(['r']);
		expect(ctx.tools.toolbarTools().map((entry) => entry.id)).toEqual(['rectangle']);

		dispose();
		expect(ctx.commands.has('tools.activate.rectangle')).toBe(false);
		expect(ctx.keymap.lookupChords('tools.activate.rectangle')).toEqual([]);
		expect(ctx.tools.toolbarTools()).toEqual([]);
	});

	it('activating by command and by shortcut, and an unknown tool is a typed error', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'move', title: 'Move', shortcut: 'V' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle', shortcut: 'R' });
		await ctx.commands.run('tools.activate.rectangle');
		expect(ctx.tools.activeId()).toBe('rectangle');
		ctx.keymap.handleKeydown({ key: 'v', code: 'KeyV' } as KeyboardEvent);
		expect(ctx.tools.activeId()).toBe('move');
		expect(() => ctx.tools.activate('nope')).toThrow(UnknownToolError);
	});

	it('toolbar tools respect order, `toolbar: false` and `when`', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'b', title: 'B', order: 2 });
		ctx.tools.register({ id: 'a', title: 'A', order: 1 });
		ctx.tools.register({ id: 'hand', title: 'Hand', order: 0, toolbar: false });
		ctx.tools.register({ id: 'gated', title: 'Gated', order: 3, when: 'canvasFocus' });
		expect(ctx.tools.toolbarTools().map((entry) => entry.id)).toEqual(['a', 'b']);
		ctx.contextKeys.set('canvasFocus', true);
		expect(ctx.tools.toolbarTools().map((entry) => entry.id)).toEqual(['a', 'b', 'gated']);
	});

	it('exposes the cursor of the active tool, from a string or a function', async () => {
		const { ctx } = await mountTools();
		let zooming = false;
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle', cursor: 'crosshair' });
		ctx.tools.register({
			id: 'zoom',
			title: 'Zoom',
			cursor: () => {
				if (zooming) return 'zoom-out';
				return 'zoom-in';
			}
		});
		expect(ctx.tools.cursor).toBe('default');
		ctx.tools.activate('rectangle');
		expect(ctx.tools.cursor).toBe('crosshair');
		ctx.tools.activate('zoom');
		expect(ctx.tools.cursor).toBe('zoom-in');
		zooming = true;
		expect(ctx.tools.cursor).toBe('zoom-out');
	});

	it('publishes the active tool as context keys', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle' });
		flushSync();
		expect(ctx.contextKeys.get('activeTool')).toBe('move');
		expect(ctx.contextKeys.get('toolIsDefault')).toBe(true);
		ctx.tools.activate('rectangle');
		flushSync();
		expect(ctx.contextKeys.get('activeTool')).toBe('rectangle');
		expect(ctx.contextKeys.get('toolIsDefault')).toBe(false);
	});
});

describe('tool lifecycle and input', () => {
	it('calls onDeactivate and onActivate in order and routes pointer and key events', async () => {
		const { ctx } = await mountTools();
		const log: string[] = [];
		ctx.tools.register(recordingTool('move', log));
		ctx.tools.register(
			recordingTool('rectangle', log, {
				onPointerDown: (event) => void log.push(`down@${event.screen.x}`),
				onPointerMove: (event) => void log.push(`move@${event.screen.x}`),
				onPointerUp: (event) => void log.push(`up@${event.screen.x}`),
				onKey: (event) => {
					log.push(`key:${event.key}`);
					return event.key === 'x';
				}
			})
		);
		log.length = 0;

		ctx.tools.activate('rectangle');
		ctx.tools.pointerDown(pointer(1));
		ctx.tools.pointerMove(pointer(2));
		ctx.tools.pointerUp(pointer(3));
		expect(ctx.tools.keyDown(keyEvent('x'))).toBe(true);
		expect(ctx.tools.keyDown(keyEvent('y'))).toBe(false);
		expect(log).toEqual([
			'move:deactivate',
			'rectangle:activate',
			'down@1',
			'move@2',
			'up@3',
			'key:x',
			'key:y'
		]);
	});

	it('the default tool is activated when it registers', async () => {
		const { ctx } = await mountTools();
		const log: string[] = [];
		ctx.tools.register(recordingTool('move', log));
		expect(log).toEqual(['move:activate']);
	});

	it('events go nowhere when the active tool is not registered', async () => {
		const { ctx } = await mountTools();
		expect(() => ctx.tools.pointerDown(pointer())).not.toThrow();
		expect(ctx.tools.keyDown(keyEvent('a'))).toBe(false);
		expect(ctx.tools.active).toBeUndefined();
	});

	it('emits tools/change', async () => {
		const { ctx } = await mountTools();
		const seen: unknown[][] = [];
		ctx.on('tools/change', (id, previous) => void seen.push([id, previous]));
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle' });
		ctx.tools.activate('rectangle');
		expect(seen).toEqual([['rectangle', 'move']]);
	});

	it('disposing the active tool hands the canvas back to the default tool', async () => {
		const { ctx } = await mountTools();
		const log: string[] = [];
		ctx.tools.register(recordingTool('move', log));
		const dispose = ctx.tools.register(recordingTool('rectangle', log));
		ctx.tools.activate('rectangle');
		log.length = 0;
		dispose();
		expect(ctx.tools.activeId()).toBe('move');
		expect(log).toEqual(['rectangle:deactivate', 'move:activate']);
	});
});

describe('sticky tools, lock and Esc', () => {
	async function withTools(): Promise<{ ctx: MountedPlugin['ctx']; log: string[] }> {
		const { ctx } = await mountTools();
		const log: string[] = [];
		ctx.tools.register(recordingTool('move', log));
		ctx.tools.register(recordingTool('rectangle', log, { onCancel: () => false }));
		return { ctx, log };
	}

	it('a finished operation reverts to Move unless the tool is locked', async () => {
		const { ctx } = await withTools();
		ctx.tools.activate('rectangle');
		ctx.tools.completeOperation();
		expect(ctx.tools.activeId()).toBe('move');

		ctx.tools.activate('rectangle', { lock: true });
		expect(ctx.tools.locked).toBe(true);
		ctx.tools.completeOperation();
		expect(ctx.tools.activeId()).toBe('rectangle');

		ctx.tools.activate('rectangle');
		expect(ctx.tools.locked).toBe(false);
	});

	it('Esc cancels the operation first, then reverts to Move', async () => {
		const { ctx } = await mountTools();
		let operation = true;
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({
			id: 'pen',
			title: 'Pen',
			onCancel: () => {
				if (!operation) return false;
				operation = false;
				return true;
			}
		});
		ctx.tools.activate('pen');
		expect(ctx.tools.cancel()).toBe(true);
		expect(ctx.tools.activeId()).toBe('pen');
		expect(operation).toBe(false);
		expect(ctx.tools.cancel()).toBe(true);
		expect(ctx.tools.activeId()).toBe('move');
		expect(ctx.tools.cancel()).toBe(false);
	});

	it('the Escape key runs the cancel command while a non-default tool is active', async () => {
		const { ctx } = await withTools();
		ctx.tools.activate('rectangle');
		flushSync();
		const consumed = ctx.keymap.handleKeydown({ key: 'Escape', code: 'Escape' } as KeyboardEvent);
		expect(consumed).toBe(true);
		await Promise.resolve();
		expect(ctx.tools.activeId()).toBe('move');

		flushSync();
		expect(ctx.keymap.handleKeydown({ key: 'Escape', code: 'Escape' } as KeyboardEvent)).toBe(
			false
		);
	});
});

describe('Escape priority', () => {
	it('cancels the tool before any other Escape binding, however it was registered', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle' });
		const ran: string[] = [];
		// Registered after core-tools and enabled on every tool: only the priority decides.
		ctx.commands.register({
			id: 'other.deselect',
			title: 'Deselect',
			run: () => void ran.push('x')
		});
		ctx.keymap.register({ key: 'Escape', command: 'other.deselect', source: 'other' });
		ctx.tools.activate('rectangle');
		flushSync();
		ctx.keymap.handleKeydown({ key: 'Escape', code: 'Escape' } as KeyboardEvent);
		await Promise.resolve();
		expect(ctx.tools.activeId()).toBe('move');
		expect(ran).toEqual([]);
		flushSync();
		ctx.keymap.handleKeydown({ key: 'Escape', code: 'Escape' } as KeyboardEvent);
		await Promise.resolve();
		expect(ran).toEqual(['x']);
	});
});

describe('temporary tools', () => {
	it('push and pop restore the previous tool, through a hold key too', async () => {
		const { ctx } = await mountTools();
		const log: string[] = [];
		ctx.tools.register(recordingTool('move', log));
		ctx.tools.register(recordingTool('rectangle', log));
		ctx.tools.register(recordingTool('hand', log, { hold: 'Space', toolbar: false }));
		ctx.tools.activate('rectangle');
		log.length = 0;

		ctx.tools.pushTemporary('hand');
		expect(ctx.tools.activeId()).toBe('hand');
		ctx.tools.pop();
		expect(ctx.tools.activeId()).toBe('rectangle');
		expect(log).toEqual([
			'rectangle:deactivate',
			'hand:activate',
			'hand:deactivate',
			'rectangle:activate'
		]);

		log.length = 0;
		ctx.keymap.handleKeydown({ key: ' ', code: 'Space' } as KeyboardEvent);
		expect(ctx.tools.activeId()).toBe('hand');
		ctx.keymap.handleKeyup({ key: ' ', code: 'Space' } as KeyboardEvent);
		expect(ctx.tools.activeId()).toBe('rectangle');
	});

	it('nests, and a finished operation does not revert while a temporary tool is up', async () => {
		const { ctx } = await mountTools();
		for (const id of ['move', 'rectangle', 'hand', 'zoom']) ctx.tools.register({ id, title: id });
		ctx.tools.activate('rectangle');
		ctx.tools.pushTemporary('hand');
		ctx.tools.pushTemporary('zoom');
		ctx.tools.completeOperation();
		expect(ctx.tools.activeId()).toBe('zoom');
		ctx.tools.pop('hand');
		expect(ctx.tools.activeId()).toBe('zoom');
		ctx.tools.pop();
		expect(ctx.tools.activeId()).toBe('rectangle');
		ctx.tools.pop();
		expect(ctx.tools.activeId()).toBe('rectangle');
	});

	it('activating a tool drops temporary tools; disposing the hold tool releases the key', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle' });
		const dispose = ctx.tools.register({ id: 'hand', title: 'Hand', hold: 'Space' });
		ctx.keymap.handleKeydown({ key: ' ', code: 'Space' } as KeyboardEvent);
		expect(ctx.tools.activeId()).toBe('hand');
		dispose();
		expect(ctx.tools.activeId()).toBe('move');
		expect(ctx.keymap.handleKeydown({ key: ' ', code: 'Space' } as KeyboardEvent)).toBe(false);
	});
});

describe('tool overlay', () => {
	it('renders the active tool overlay component in canvas-overlay and swaps with the tool', async () => {
		const { ctx } = await mountTools();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({
			id: 'rectangle',
			title: 'Rectangle',
			overlay: { component: PlaceholderText, props: { text: 'rectangle guides' } }
		});
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'canvas-overlay' } });
		flushSync();
		expect(target.textContent).not.toContain('rectangle guides');
		ctx.tools.activate('rectangle');
		flushSync();
		expect(target.textContent).toContain('rectangle guides');
		ctx.tools.activate('move');
		flushSync();
		expect(target.textContent).not.toContain('rectangle guides');
	});
});

describePlugin('core-tools', coreTools, {
	providers: [coreRegions, coreContextKeys, coreCommands, coreKeymap],
	contributes: ({ ctx }) => {
		expect(ctx.tools).toBeDefined();
		expect(ctx.commands.has('tools.cancel')).toBe(true);
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toEqual([
			'core-tools/overlay'
		]);
		expect(ctx.contextKeys.get('activeTool')).toBe('move');
	}
});
