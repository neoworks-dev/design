import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreRegions from '../core-regions';
import commandPalette from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap];

describePlugin('command-palette', commandPalette, {
	providers,
	contributes: ({ ctx, currentState }) => {
		expect(ctx.palette.sourceList().map((source) => source.id)).toEqual(['commands']);
		expect(ctx.commands.has('palette.toggle')).toBe(true);
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toEqual([
			'command-palette/dialog'
		]);
		expect(currentState().registries['keymap.registry']).toContain(
			'command-palette|global|ctrl+k|palette.toggle'
		);
	}
});

let mounted: MountedPlugin | undefined;
let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
const ran: string[] = [];

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
	ran.length = 0;
});

async function mountPalette(): Promise<MountedPlugin> {
	mounted = await mountPlugin(commandPalette, { providers });
	const { ctx } = mounted;
	const definitions = [
		{ id: 'view.zoom-to-fit', title: 'Zoom to fit', when: undefined },
		{ id: 'view.zoom-in', title: 'Zoom in', when: undefined },
		{ id: 'edit.rename', title: 'Rename', when: 'hasSelection' }
	];
	for (const definition of definitions) {
		ctx.commands.register({
			id: definition.id,
			title: definition.title,
			when: definition.when,
			run: () => void ran.push(definition.id)
		});
	}
	ctx.keymap.register({ key: 'Shift+1', command: 'view.zoom-to-fit', source: 'test' });
	return mounted;
}

function render(ctx: MountedPlugin['ctx']): HTMLElement {
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'overlay' } });
	flushSync();
	return target;
}

function press(element: HTMLElement, key: string, shiftKey = false): void {
	const input = element.querySelector('input');
	input?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
	flushSync();
}

function typeInto(element: HTMLElement, text: string): void {
	const input = element.querySelector('input');
	if (!input) throw new Error('palette is not open');
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function titles(element: HTMLElement): string[] {
	return [...element.querySelectorAll('[role=option]')].map((row) =>
		(row.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

describe('palette service', () => {
	it('lists the commands, fuzzy-filters them and keeps the best match first', async () => {
		const { ctx } = await mountPalette();
		ctx.palette.open();
		expect(ctx.palette.rows().map((row) => row.item.id)).toEqual([
			'palette.toggle',
			'view.zoom-to-fit',
			'view.zoom-in',
			'edit.rename'
		]);
		ctx.palette.setQuery('zin');
		expect(ctx.palette.rows().map((row) => row.item.id)).toEqual(['view.zoom-in']);
		ctx.palette.setQuery('zf');
		expect(ctx.palette.rows().map((row) => row.item.id)).toEqual(['view.zoom-to-fit']);
	});

	it('shows commands with a failing when disabled, with the accelerator from the keymap', async () => {
		const { ctx } = await mountPalette();
		ctx.palette.open();
		const rows = ctx.palette.rows();
		expect(rows.find((row) => row.item.id === 'edit.rename')?.item.enabled).toBe(false);
		expect(rows.find((row) => row.item.id === 'view.zoom-to-fit')?.item.accelerator).toBe(
			'Shift+1'
		);
		await ctx.palette.run(rows.find((row) => row.item.id === 'edit.rename')?.item ?? rows[0].item);
		expect(ran).not.toContain('edit.rename');
	});

	it('remembers the last command and lists it first on an empty query', async () => {
		const { ctx } = await mountPalette();
		ctx.palette.open();
		ctx.palette.setQuery('rename');
		ctx.contextKeys.set('hasSelection', true);
		await ctx.palette.runSelected();
		ctx.palette.open();
		expect(ctx.palette.rows()[0].item.id).toBe('edit.rename');
		expect(ctx.palette.isOpen).toBe(true);
	});

	it('Tab cycles through the registered sources', async () => {
		const { ctx } = await mountPalette();
		ctx.palette.registerSource({
			id: 'pages',
			title: 'Pages',
			order: 10,
			items: () => [{ id: 'p1', title: 'Page 1', run: () => void ran.push('p1') }]
		});
		ctx.palette.open();
		ctx.palette.cycleSource(1);
		expect(ctx.palette.sourceId).toBe('pages');
		ctx.palette.cycleSource(1);
		expect(ctx.palette.sourceId).toBe('commands');
		ctx.palette.cycleSource(-1);
		expect(ctx.palette.sourceId).toBe('pages');
	});

	it('appends the fallback row of a source for a non-empty query', async () => {
		const { ctx } = await mountPalette();
		ctx.palette.registerSource({
			id: 'ask',
			title: 'Ask',
			items: () => [],
			fallback: (query) => ({ id: 'ask', title: `Ask: ${query}`, run: () => void ran.push(query) })
		});
		ctx.palette.open('ask');
		expect(ctx.palette.rows()).toEqual([]);
		ctx.palette.setQuery('make it blue');
		await ctx.palette.runSelected();
		expect(ran).toEqual(['make it blue']);
	});
});

describe('palette dialog', () => {
	it('opens through its command and shortcut, searches and runs with Enter', async () => {
		const { ctx } = await mountPalette();
		const element = render(ctx);
		expect(element.querySelector('[data-palette]')).toBeNull();

		const handled = ctx.keymap.handleKeydown({
			key: 'k',
			code: 'KeyK',
			ctrlKey: true,
			preventDefault: () => {}
		} as KeyboardEvent);
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(handled).toBe(true);
		expect(element.querySelector('[data-palette]')).not.toBeNull();

		typeInto(element, 'zoom');
		expect(titles(element)).toHaveLength(2);
		press(element, 'ArrowDown');
		press(element, 'Enter');
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(ran).toEqual(['view.zoom-to-fit']);
		expect(element.querySelector('[data-palette]')).toBeNull();
	});

	it('Escape closes and the arrow keys wrap around', async () => {
		const { ctx } = await mountPalette();
		const element = render(ctx);
		ctx.palette.open();
		flushSync();
		press(element, 'ArrowUp');
		expect(ctx.palette.index).toBe(3);
		press(element, 'ArrowDown');
		expect(ctx.palette.index).toBe(0);
		press(element, 'Escape');
		expect(element.querySelector('[data-palette]')).toBeNull();
		expect(ran).toEqual([]);
	});

	it('shows the source tabs once there is more than one', async () => {
		const { ctx } = await mountPalette();
		const element = render(ctx);
		ctx.palette.open();
		flushSync();
		expect(element.querySelector('[role=tablist]')).toBeNull();
		ctx.palette.registerSource({ id: 'pages', title: 'Pages', order: 10, items: () => [] });
		flushSync();
		expect(element.querySelectorAll('[role=tab]')).toHaveLength(2);
		press(element, 'Tab');
		expect(ctx.palette.sourceId).toBe('pages');
	});
});
