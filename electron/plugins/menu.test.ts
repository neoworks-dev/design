import { describe, expect, it } from 'vitest';
import type { NativeMenuItem } from '../bridge';
import { bootMinimalKernel, settle } from '../kernel/testing';
import { buildHostMenu, mainMenuPlugin } from './menu';

function leaf(label: string, command: string, extra: Partial<NativeMenuItem> = {}): NativeMenuItem {
	return {
		label,
		command,
		enabled: true,
		checked: false,
		separatorBefore: false,
		...extra
	};
}

const MENU_BAR: NativeMenuItem[] = [
	{
		label: 'File',
		enabled: true,
		checked: false,
		separatorBefore: false,
		submenu: [
			leaf('New file', 'file.new', { accelerator: 'CommandOrControl+N' }),
			leaf('Save', 'file.save', { accelerator: 'CommandOrControl+S', separatorBefore: true })
		]
	},
	{
		label: 'View',
		enabled: true,
		checked: false,
		separatorBefore: false,
		submenu: [leaf('Pixel grid', 'view.toggle-pixel-grid', { checked: true, enabled: false })]
	}
];

describe('buildHostMenu', () => {
	it('mirrors labels, separators, accelerators, checked and enabled state', () => {
		const template = buildHostMenu(MENU_BAR, 'linux', () => {});
		expect(template.map((item) => item.label)).toEqual(['File', 'View']);
		const file = template[0].submenu;
		expect(file?.map((item) => item.type ?? item.label)).toEqual(['normal', 'separator', 'normal']);
		expect(file?.[0]).toMatchObject({
			label: 'New file',
			accelerator: 'CommandOrControl+N',
			registerAccelerator: false,
			enabled: true
		});
		expect(template[1].submenu?.[0]).toMatchObject({
			type: 'checkbox',
			checked: true,
			enabled: false
		});
	});

	it('a click runs the item command with its arguments', () => {
		const calls: [string, unknown][] = [];
		const items = [leaf('Rename', 'edit.rename', { args: { from: 'menu' } })];
		const template = buildHostMenu(items, 'linux', (command, args) => calls.push([command, args]));
		template[0].click?.();
		expect(calls).toEqual([['edit.rename', { from: 'menu' }]]);
	});

	it('macOS gets the standard application menu first', () => {
		const template = buildHostMenu(MENU_BAR, 'darwin', () => {});
		expect(template[0]).toEqual({ role: 'appMenu' });
		expect(template.slice(1).map((item) => item.label)).toEqual(['File', 'View']);
	});
});

describe('main-menu', () => {
	it('sets the application menu from menu:set, routes clicks back, and clears it on unload', async () => {
		const kernel = await bootMinimalKernel([{ plugin: mainMenuPlugin }]);
		const { host, window } = kernel;
		expect(host.snapshot().handlers).toContain('menu:set');

		const result = await host.invoke('menu:set', MENU_BAR);
		expect(result).toEqual({ ok: true, value: undefined });
		expect(host.applicationMenu?.map((item) => item.label)).toEqual(['File', 'View']);

		host.applicationMenu?.[0].submenu?.[0].click?.();
		expect(window.sent).toContainEqual({
			channel: 'menu:command',
			payload: { command: 'file.new', args: undefined }
		});

		await kernel.root.fiber.dispose();
		await settle();
		expect(host.applicationMenu).toEqual([]);
		expect(host.handlers.has('menu:set')).toBe(false);
	});

	it('rejects a malformed menu', async () => {
		const { host } = await bootMinimalKernel([{ plugin: mainMenuPlugin }]);
		const result = await host.invoke('menu:set', [{ label: 1 }]);
		expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});
});
