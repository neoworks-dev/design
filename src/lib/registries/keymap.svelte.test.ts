import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import type { KeydownEventLike } from './keymap.svelte';

const providers = [coreContextKeys, coreCommands];

interface Harness {
	mounted: MountedPlugin;
	ran: string[];
}

async function mountKeymap(platform = 'linux'): Promise<Harness> {
	const mounted = await mountPlugin(coreKeymap, { providers, config: { platform } });
	const ran: string[] = [];
	for (const id of ['tool.move', 'tool.text', 'ui.toggle', 'field.accept', 'nudge', 'zoom.fit']) {
		mounted.ctx.commands.register({
			id,
			title: id,
			run: (args) => void ran.push(args === undefined ? id : `${id}:${JSON.stringify(args)}`)
		});
	}
	return { mounted, ran };
}

function keydown(overrides: Partial<KeydownEventLike> & { key: string }): KeydownEventLike {
	return {
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		preventDefault: () => {},
		...overrides
	};
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const inputTarget = { tagName: 'INPUT' };
const editableTarget = { tagName: 'DIV', isContentEditable: true };

describe('keymap resolution', () => {
	it('fires a global binding', async () => {
		const { mounted, ran } = await mountKeymap();
		mounted.ctx.keymap.register({ key: 'Mod+\\', command: 'ui.toggle' });
		const handled = mounted.ctx.keymap.handleKeydown(
			keydown({ key: '\\', code: 'Backslash', ctrlKey: true })
		);
		await flush();
		expect(handled).toBe(true);
		expect(ran).toEqual(['ui.toggle']);
		await mounted.cleanup();
	});

	it('only fires a canvas binding while the canvas scope is pushed', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'V', command: 'tool.move', scope: 'canvas' });
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(false);

		const leave = keymap.pushScope('canvas');
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(true);
		await flush();
		expect(ran).toEqual(['tool.move']);

		leave();
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(false);
		await mounted.cleanup();
	});

	it('prefers the more specific scope for the same chord', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'T', command: 'tool.move', scope: 'global' });
		keymap.register({ key: 'T', command: 'tool.text', scope: 'canvas' });
		keymap.pushScope('canvas');
		keymap.handleKeydown(keydown({ key: 't', code: 'KeyT' }));
		await flush();
		expect(ran).toEqual(['tool.text']);
		await mounted.cleanup();
	});

	it('never triggers tool shortcuts while typing in a text field', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'V', command: 'tool.move', scope: 'canvas' });
		keymap.register({ key: 'T', command: 'tool.text', scope: 'global' });
		keymap.pushScope('canvas');
		for (const target of [inputTarget, { tagName: 'TEXTAREA' }, editableTarget]) {
			expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV', target }))).toBe(false);
			expect(keymap.handleKeydown(keydown({ key: 't', code: 'KeyT', target }))).toBe(false);
		}
		await flush();
		expect(ran).toEqual([]);
		await mounted.cleanup();
	});

	it('fires input and text-edit scoped bindings in editable targets', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'Enter', command: 'field.accept', scope: 'input' });
		keymap.register({ key: 'Mod+Enter', command: 'ui.toggle', scope: 'text-edit' });
		expect(
			keymap.handleKeydown(keydown({ key: 'Enter', code: 'Enter', target: inputTarget }))
		).toBe(true);
		expect(
			keymap.handleKeydown(
				keydown({ key: 'Enter', code: 'Enter', ctrlKey: true, target: editableTarget })
			)
		).toBe(true);
		expect(keymap.handleKeydown(keydown({ key: 'Enter', code: 'Enter' }))).toBe(false);
		await flush();
		expect(ran).toEqual(['field.accept', 'ui.toggle']);
		await mounted.cleanup();
	});

	it('lets a binding opt in to firing inside editable targets', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'Mod+K', command: 'ui.toggle', allowInEditable: true });
		keymap.handleKeydown(keydown({ key: 'k', code: 'KeyK', ctrlKey: true, target: inputTarget }));
		await flush();
		expect(ran).toEqual(['ui.toggle']);
		await mounted.cleanup();
	});

	it('resolves Mod to Ctrl on linux and to Cmd on macOS', async () => {
		const linux = await mountKeymap('linux');
		linux.mounted.ctx.keymap.register({ key: 'Mod+K', command: 'ui.toggle' });
		const ctrlK = keydown({ key: 'k', code: 'KeyK', ctrlKey: true });
		const cmdK = keydown({ key: 'k', code: 'KeyK', metaKey: true });
		expect(linux.mounted.ctx.keymap.handleKeydown(ctrlK)).toBe(true);
		expect(linux.mounted.ctx.keymap.handleKeydown(cmdK)).toBe(false);
		await linux.mounted.cleanup();

		const mac = await mountKeymap('darwin');
		mac.mounted.ctx.keymap.register({ key: 'Mod+K', command: 'ui.toggle' });
		expect(mac.mounted.ctx.keymap.handleKeydown(cmdK)).toBe(true);
		expect(mac.mounted.ctx.keymap.handleKeydown(ctrlK)).toBe(false);
		await mac.mounted.cleanup();
	});

	it('honours the when expression of a binding', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap, contextKeys } = mounted.ctx;
		keymap.register({ key: 'Mod+D', command: 'ui.toggle', when: 'hasSelection' });
		const press = (): boolean =>
			keymap.handleKeydown(keydown({ key: 'd', code: 'KeyD', ctrlKey: true }));
		expect(press()).toBe(false);
		contextKeys.set('hasSelection', true);
		expect(press()).toBe(true);
		await flush();
		expect(ran).toEqual(['ui.toggle']);
		await mounted.cleanup();
	});

	it('skips bindings of unknown or disabled commands without consuming the key', async () => {
		const { mounted } = await mountKeymap();
		const { keymap, commands } = mounted.ctx;
		keymap.register({ key: 'Mod+J', command: 'does.not.exist' });
		commands.register({ id: 'needs.key', title: 'x', when: 'flag', run: () => {} });
		keymap.register({ key: 'Mod+L', command: 'needs.key' });
		expect(keymap.handleKeydown(keydown({ key: 'j', code: 'KeyJ', ctrlKey: true }))).toBe(false);
		expect(keymap.handleKeydown(keydown({ key: 'l', code: 'KeyL', ctrlKey: true }))).toBe(false);
		await mounted.cleanup();
	});

	it('passes args to the command', async () => {
		const { mounted, ran } = await mountKeymap();
		mounted.ctx.keymap.register({ key: 'Shift+1', command: 'zoom.fit', args: { level: 1 } });
		mounted.ctx.keymap.handleKeydown(keydown({ key: '!', code: 'Digit1', shiftKey: true }));
		await flush();
		expect(ran).toEqual(['zoom.fit:{"level":1}']);
		await mounted.cleanup();
	});

	it('ignores key repeat unless the binding opts in', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'ArrowUp', command: 'nudge', scope: 'global', repeat: true });
		keymap.register({ key: 'Space', command: 'tool.move' });
		const repeated = (key: string, code: string): KeydownEventLike =>
			keydown({ key, code, repeat: true });
		expect(keymap.handleKeydown(repeated('ArrowUp', 'ArrowUp'))).toBe(true);
		expect(keymap.handleKeydown(repeated(' ', 'Space'))).toBe(true);
		await flush();
		expect(ran).toEqual(['nudge']);
		await mounted.cleanup();
	});
});

describe('keymap registry rules', () => {
	it('disposing a binding removes only that binding', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		const disposeFirst = keymap.register({ key: 'Mod+1', command: 'tool.move' });
		keymap.register({ key: 'Mod+2', command: 'tool.text' });
		disposeFirst();
		expect(keymap.handleKeydown(keydown({ key: '1', code: 'Digit1', ctrlKey: true }))).toBe(false);
		expect(keymap.handleKeydown(keydown({ key: '2', code: 'Digit2', ctrlKey: true }))).toBe(true);
		await mounted.cleanup();
	});

	it('a stale disposer leaves the replacing binding in place', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		const stale = keymap.register({ key: 'Mod+1', command: 'tool.move', source: 'test' });
		keymap.register({ key: 'Mod+1', command: 'tool.move', source: 'test' });
		stale();
		expect(keymap.handleKeydown(keydown({ key: '1', code: 'Digit1', ctrlKey: true }))).toBe(true);
		await mounted.cleanup();
	});

	it('rejects invalid chords and malformed when expressions', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		expect(() => keymap.register({ key: 'Mod+Nope', command: 'ui.toggle' })).toThrow(/chord/);
		expect(() => keymap.register({ key: 'Mod+K', command: 'ui.toggle', when: 'a &&' })).toThrow(
			/when expression/
		);
		await mounted.cleanup();
	});

	it('user overrides rebind or unbind commands and win over defaults', async () => {
		const { mounted, ran } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'V', command: 'tool.move', scope: 'canvas' });
		keymap.pushScope('canvas');

		const rebind = keymap.setOverride('canvas', 'tool.move', 'M');
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(false);
		expect(keymap.handleKeydown(keydown({ key: 'm', code: 'KeyM' }))).toBe(true);
		await flush();
		expect(ran).toEqual(['tool.move']);

		rebind();
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(true);

		keymap.setOverride('canvas', 'tool.move', null);
		expect(keymap.handleKeydown(keydown({ key: 'v', code: 'KeyV' }))).toBe(false);
		await mounted.cleanup();
	});

	it('swaps presets without touching plugin bindings', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'R', command: 'tool.move', source: 'preset:figma' });
		keymap.register({ key: 'B', command: 'tool.move', source: 'preset:penpot' });
		keymap.register({ key: 'Mod+K', command: 'ui.toggle', source: 'some-plugin' });
		const press = (key: string, code: string, ctrlKey = false): boolean =>
			keymap.handleKeydown(keydown({ key, code, ctrlKey }));

		expect(press('r', 'KeyR')).toBe(true);
		expect(press('b', 'KeyB')).toBe(false);
		keymap.setPreset('penpot');
		expect(press('r', 'KeyR')).toBe(false);
		expect(press('b', 'KeyB')).toBe(true);
		expect(press('k', 'KeyK', true)).toBe(true);
		await mounted.cleanup();
	});

	it('looks up the accelerator of a command for menus', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		keymap.register({ key: 'Mod+Shift+\\', command: 'ui.toggle' });
		expect(keymap.lookup('ui.toggle')).toBe('Ctrl+Shift+\\');
		expect(keymap.lookup('tool.move')).toBeUndefined();
		keymap.setOverride('global', 'ui.toggle', 'Mod+K');
		expect(keymap.lookup('ui.toggle')).toBe('Ctrl+K');
		await mounted.cleanup();
	});
});

describe('keymap hold', () => {
	it('starts on key down, ends on key up, ignores repeat', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		const log: string[] = [];
		keymap.hold(
			'Space',
			() => log.push('start'),
			() => log.push('end')
		);
		expect(keymap.handleKeydown(keydown({ key: ' ', code: 'Space' }))).toBe(true);
		keymap.handleKeydown(keydown({ key: ' ', code: 'Space', repeat: true }));
		keymap.handleKeyup(keydown({ key: ' ', code: 'Space' }));
		expect(log).toEqual(['start', 'end']);
		await mounted.cleanup();
	});

	it('does not start inside a text field', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		const log: string[] = [];
		keymap.hold(
			'Space',
			() => log.push('start'),
			() => log.push('end')
		);
		expect(keymap.handleKeydown(keydown({ key: ' ', code: 'Space', target: inputTarget }))).toBe(
			false
		);
		expect(log).toEqual([]);
		await mounted.cleanup();
	});

	it('ends a running hold on blur and when disposed', async () => {
		const { mounted } = await mountKeymap();
		const { keymap } = mounted.ctx;
		const log: string[] = [];
		const dispose = keymap.hold(
			'Z',
			() => log.push('start'),
			() => log.push('end')
		);
		keymap.handleKeydown(keydown({ key: 'z', code: 'KeyZ' }));
		keymap.handleBlur();
		expect(log).toEqual(['start', 'end']);

		keymap.handleKeydown(keydown({ key: 'z', code: 'KeyZ' }));
		dispose();
		expect(log).toEqual(['start', 'end', 'start', 'end']);
		expect(keymap.handleKeydown(keydown({ key: 'z', code: 'KeyZ' }))).toBe(false);
		await mounted.cleanup();
	});
});

describePlugin('core-keymap', coreKeymap, {
	providers,
	config: { platform: 'linux' },
	contributes: async ({ ctx, currentState }) => {
		expect(currentState().domListeners).toEqual({
			'window:keydown': 1,
			'window:keyup': 1,
			'window:blur': 1
		});

		const ran: string[] = [];
		const disposeCommand = ctx.commands.register({
			id: 'probe.run',
			title: 'Probe',
			run: () => void ran.push('ran')
		});
		const dispose = ctx.keymap.register({ key: 'Mod+Shift+P', command: 'probe.run' });
		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })
		);
		await flush();
		expect(ran).toEqual(['ran']);
		dispose();
		disposeCommand();
	}
});
