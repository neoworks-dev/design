import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { at, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import prototypePanel from '../prototype-panel';
import prototypeRuntime from '../prototype-runtime';
import spatial from '../spatial';
import presentation from './index';

const headlessRenderer: Plugin = {
	name: 'headlessRenderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportNode: () =>
				Promise.resolve({
					bytes: new Uint8Array([1]),
					width: 1,
					height: 1,
					format: 'PNG',
					mimeType: 'image/png'
				})
		});
	}
};

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'one', name: 'One', transform: at(0, 0), width: 100, height: 100 }),
				frame({ id: 'two', name: 'Two', transform: at(200, 0), width: 100, height: 100 }, [
					rectangle({ id: 'inner', width: 10, height: 10 })
				])
			],
			{ id: 'p' }
		)
	]);
}

function providers(): Plugin[] {
	return [
		...editingProviders(scene()),
		corePanels,
		prototypePanel,
		spatial,
		headlessRenderer,
		prototypeRuntime
	];
}

describePlugin('presentation', presentation, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'presentation/view'
		);
		expect(ctx.commands.has('presentation.present')).toBe(true);
		expect(ctx.commands.has('presentation.preview')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('shift+space');
		expect(chords).toContain('ctrl+alt+enter');
	}
});

let mounted: MountedPlugin | undefined;
let host: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountPresentation(): Promise<Context> {
	mounted = await mountPlugin(presentation, { providers: providers() });
	return mounted.ctx;
}

function press(ctx: Context, key: string): void {
	ctx.keymap.handleKeydown({
		key,
		code: key,
		ctrlKey: false,
		shiftKey: false,
		metaKey: false,
		altKey: false
	});
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('opening and closing', () => {
	it('opens at the selected frame and closes cleanly', async () => {
		const ctx = await mountPresentation();
		ctx.selection.select(['inner']);
		expect(await ctx.commands.run('presentation.preview')).toBeUndefined();
		expect(ctx.presentation.mode).toBe('preview');
		expect(ctx.presentation.session?.current).toBe('two');
		flushSync();
		expect(ctx.contextKeys.get('presenting')).toBe(true);

		ctx.presentation.close();
		flushSync();
		expect(ctx.presentation.session).toBeNull();
		expect(ctx.contextKeys.get('presenting')).toBe(false);
	});

	it('present and preview replace each other, never stack', async () => {
		const ctx = await mountPresentation();
		await ctx.commands.run('presentation.present');
		const first = ctx.presentation.session;
		await ctx.commands.run('presentation.preview');
		expect(ctx.presentation.mode).toBe('preview');
		expect(ctx.presentation.session).not.toBe(first);
	});

	it('disposing the plugin closes the presentation', async () => {
		const ctx = await mountPresentation();
		await ctx.commands.run('presentation.present');
		const service = ctx.presentation;
		const regions = ctx.regions;
		expect(service.isOpen).toBe(true);
		await mounted?.fiber.dispose();
		await settle();
		expect(service.isOpen).toBe(false);
		expect(regions.contributions('overlay').map((entry) => entry.id)).not.toContain(
			'presentation/view'
		);
	});
});

describe('keyboard', () => {
	it('steps with the arrow keys, restarts with R and closes with Escape', async () => {
		const ctx = await mountPresentation();
		await ctx.commands.run('presentation.preview');
		expect(ctx.presentation.session?.current).toBe('one');

		press(ctx, 'ArrowRight');
		await settle();
		expect(ctx.presentation.session?.current).toBe('two');
		press(ctx, 'ArrowLeft');
		await settle();
		expect(ctx.presentation.session?.current).toBe('one');
		press(ctx, 'ArrowRight');
		await settle();
		press(ctx, 'r');
		await settle();
		expect(ctx.presentation.session?.current).toBe('one');

		press(ctx, 'Escape');
		await settle();
		expect(ctx.presentation.isOpen).toBe(false);
	});

	it('leaves the keys to the editor while nothing is playing', async () => {
		const ctx = await mountPresentation();
		press(ctx, 'ArrowRight');
		await settle();
		expect(ctx.presentation.isOpen).toBe(false);
	});
});

describe('view', () => {
	it('renders the player bar and the frame, and removes them on close', async () => {
		const ctx = await mountPresentation();
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'overlay' } });
		await ctx.commands.run('presentation.preview');
		flushSync();
		await settle();
		flushSync();
		expect(target.querySelector('[data-presentation="preview"]')).not.toBeNull();
		expect(target.querySelector('[data-presentation-bar]')).not.toBeNull();
		expect(target.querySelector('[data-player-frame="one"]')).not.toBeNull();

		ctx.presentation.close();
		flushSync();
		expect(target.querySelector('[data-presentation]')).toBeNull();
	});
});
