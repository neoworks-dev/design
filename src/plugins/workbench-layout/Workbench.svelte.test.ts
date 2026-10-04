import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreRegions from '../core-regions';
import placeholderShell from '../placeholder-shell';
import workbenchLayout from './index';
import { LAYOUT_STORAGE_KEY } from './layoutState.svelte';
import { memoryStorage, type MemoryStorage } from './testStorage';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap];

type ObserverCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;

class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	observed: unknown[] = [];
	disconnected = false;

	constructor(readonly callback: ObserverCallback) {
		FakeResizeObserver.instances.push(this);
	}

	observe(element: unknown): void {
		this.observed.push(element);
	}

	disconnect(): void {
		this.disconnected = true;
	}

	unobserve(): void {}
}

let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
let mounted: MountedPlugin | undefined;
let originalResizeObserver: unknown;

beforeEach(() => {
	FakeResizeObserver.instances = [];
	originalResizeObserver = Reflect.get(globalThis, 'ResizeObserver');
	Reflect.set(globalThis, 'ResizeObserver', FakeResizeObserver);
});

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
	Reflect.set(globalThis, 'ResizeObserver', originalResizeObserver);
});

async function renderWorkbench(
	storage = memoryStorage(),
	withShell = true
): Promise<{ mounted: MountedPlugin; storage: MemoryStorage }> {
	mounted = await mountPlugin(workbenchLayout, { providers, config: { storage } });
	if (withShell) await mounted.ctx.plugin(placeholderShell);
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, {
		target,
		props: { ctx: mounted.ctx, region: 'root', emptyMessage: 'No layout plugin loaded' }
	});
	flushSync();
	return { mounted, storage };
}

function sidebar(side: 'left' | 'right'): Element | null {
	return target?.querySelector(`[data-sidebar=${side}]`) ?? null;
}

describe('workbench-layout rendering', () => {
	it('arranges left, canvas and right with a floating toolbar', async () => {
		await renderWorkbench();
		expect(sidebar('left')).not.toBeNull();
		expect(sidebar('right')).not.toBeNull();
		expect(target?.querySelector('[data-region=canvas]')).not.toBeNull();
		expect(target?.querySelector('[data-region=toolbar] [role=toolbar]')).not.toBeNull();
	});

	it('shows no sidebar for a region without contributions', async () => {
		await renderWorkbench(memoryStorage(), false);
		expect(sidebar('left')).toBeNull();
		expect(sidebar('right')).toBeNull();
		expect(target?.querySelector('[data-region=canvas]')).not.toBeNull();
	});

	it('shows the empty state once the workbench-layout plugin is removed', async () => {
		const { mounted } = await renderWorkbench();
		await mounted.fiber.dispose();
		flushSync();
		expect(target?.querySelector('[data-workbench]')).toBeNull();
		expect(target?.querySelector('[data-region-empty=root]')?.textContent).toContain(
			'No layout plugin loaded'
		);
	});

	it('hides sidebars through the commands and the shortcut', async () => {
		const { mounted } = await renderWorkbench();
		await mounted.ctx.commands.run('workbench-layout.toggle-left-sidebar');
		flushSync();
		expect(sidebar('left')).toBeNull();
		expect(sidebar('right')).not.toBeNull();

		mounted.ctx.keymap.handleKeydown({
			key: '|',
			code: 'Backslash',
			ctrlKey: true,
			shiftKey: true,
			metaKey: false,
			altKey: false
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(sidebar('left')).not.toBeNull();
	});

	it('hides all chrome with Ctrl+\\ but keeps the canvas', async () => {
		const { mounted } = await renderWorkbench();
		mounted.ctx.keymap.handleKeydown({
			key: '\\',
			code: 'Backslash',
			ctrlKey: true,
			shiftKey: false,
			metaKey: false,
			altKey: false
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(sidebar('left')).toBeNull();
		expect(sidebar('right')).toBeNull();
		expect(target?.querySelector('[data-region=toolbar]')).toBeNull();
		expect(target?.querySelector('[data-region=canvas]')).not.toBeNull();
	});

	it('resizes with the keyboard, resets on double click and persists', async () => {
		const { storage } = await renderWorkbench();
		const handle = target?.querySelector<HTMLElement>('[data-resize-handle=left]');
		const left = sidebar('left')?.parentElement;
		expect(left?.style.width).toBe('240px');

		handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		flushSync();
		expect(left?.style.width).toBe('256px');

		await Promise.resolve();
		flushSync();
		expect(JSON.parse(storage.values[LAYOUT_STORAGE_KEY]).leftWidth).toBe(256);

		handle?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		expect(left?.style.width).toBe('240px');
	});

	it('restores collapsed sidebars and widths from storage on start', async () => {
		const storage = memoryStorage({
			[LAYOUT_STORAGE_KEY]: JSON.stringify({ leftWidth: 300, rightCollapsed: true })
		});
		await renderWorkbench(storage);
		expect(sidebar('left')?.parentElement?.style.width).toBe('300px');
		expect(sidebar('right')).toBeNull();
	});

	it('observes the canvas through ctx.effect and reports its size', async () => {
		const { mounted } = await renderWorkbench();
		const observer = FakeResizeObserver.instances[0];
		expect(observer.observed).toHaveLength(1);
		expect(mounted.fiber.getEffects().map((effect) => effect.label)).toContain(
			'workbench-layout/canvas-resize'
		);

		const sizes: unknown[] = [];
		mounted.ctx.on('canvas/resize', (size) => void sizes.push(size));
		observer.callback([{ contentRect: { width: 800, height: 600 } }]);
		expect(sizes).toEqual([{ width: 800, height: 600 }]);

		await unmount(host as never);
		host = undefined;
		expect(observer.disconnected).toBe(true);
	});
});

describePlugin('workbench-layout', workbenchLayout, {
	providers,
	config: { storage: memoryStorage() },
	contributes: ({ ctx }) => {
		const root = ctx.regions.contributions('root');
		expect(root.map((entry) => entry.id)).toEqual(['workbench-layout/root']);
		expect(ctx.commands.has('workbench-layout.toggle-ui')).toBe(true);
		expect(ctx.keymap.lookup('workbench-layout.toggle-ui')).toBe('Ctrl+\\');
		expect(ctx.keymap.lookup('workbench-layout.toggle-left-sidebar')).toBe('Ctrl+Shift+\\');
	}
});
