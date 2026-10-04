import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { RegionContribution } from '../registries/regions.svelte';
import coreRegions from '../../plugins/core-regions';
import { getKernel } from './context';
import NoHost from './fixtures/NoHost.svelte';
import Hello from './fixtures/Hello.svelte';
import HostRoot from './fixtures/HostRoot.svelte';
import ShowsKernel from './fixtures/ShowsKernel.svelte';
import Throws from './fixtures/Throws.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from './testing';

function contributor(
	name: string,
	contributions: RegionContribution[]
): { name: string; inject: string[]; apply: (ctx: Context) => void } {
	return {
		name,
		inject: ['regions'],
		apply(ctx: Context): void {
			for (const contribution of contributions) {
				ctx.effect(() => ctx.regions.register(contribution), `contribute ${contribution.id}`);
			}
		}
	};
}

let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
let mounted: MountedPlugin | undefined;

async function render(
	plugin: ReturnType<typeof contributor>,
	region: string,
	emptyMessage?: string
): Promise<MountedPlugin> {
	mounted = await mountPlugin(plugin, { providers: [coreRegions] });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region, emptyMessage } });
	flushSync();
	return mounted;
}

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

describe('RegionHost', () => {
	it('adds the component to the DOM on register and removes it on dispose', async () => {
		const plugin = contributor('owner', [{ id: 'owner/hello', region: 'left', component: Hello }]);
		const { fiber } = await render(plugin, 'left');
		expect(target?.querySelector('[data-testid=hello]')?.textContent).toBe('hello');

		await fiber.dispose();
		flushSync();
		expect(target?.querySelector('[data-testid=hello]')).toBeNull();
	});

	it('only renders contributions of the requested region', async () => {
		const plugin = contributor('owner', [
			{ id: 'owner/left', region: 'left', component: Hello },
			{ id: 'owner/right', region: 'right', component: ShowsKernel }
		]);
		await render(plugin, 'right');
		expect(target?.querySelector('[data-testid=hello]')).toBeNull();
		expect(target?.querySelector('[data-testid=owner]')).not.toBeNull();
	});

	it('renders with the owning plugin ctx, and component effects attach to that fiber', async () => {
		const plugin = contributor('owner', [
			{ id: 'owner/kernel', region: 'left', component: ShowsKernel }
		]);
		const { fiber, ctx } = await render(plugin, 'left');
		expect(target?.querySelector('[data-testid=owner]')?.textContent).toBe('owner');

		const pluginLabels = fiber.getEffects().map((effect) => effect.label);
		expect(pluginLabels).toContain('component effect');
		const rootLabels = ctx.root.fiber.getEffects().map((effect) => effect.label);
		expect(rootLabels).not.toContain('component effect');
	});

	it('isolates a throwing component behind an error tile', async () => {
		const plugin = contributor('owner', [
			{ id: 'owner/broken', region: 'left', component: Throws },
			{ id: 'owner/fine', region: 'left', component: Hello }
		]);
		await render(plugin, 'left');
		const tile = target?.querySelector('[role=alert]');
		expect(tile?.textContent).toContain('owner/broken');
		expect(tile?.textContent).toContain('component exploded');
		expect(target?.querySelector('[data-testid=hello]')).not.toBeNull();
	});

	it('hides contributions whose when() is false', async () => {
		let visible = $state(false);
		const plugin = contributor('owner', [
			{ id: 'owner/maybe', region: 'left', component: Hello, when: () => visible }
		]);
		await render(plugin, 'left');
		expect(target?.querySelector('[data-testid=hello]')).toBeNull();
		visible = true;
		flushSync();
		expect(target?.querySelector('[data-testid=hello]')).not.toBeNull();
		visible = false;
		flushSync();
		expect(target?.querySelector('[data-testid=hello]')).toBeNull();
	});

	it('orders contributions by order', async () => {
		const plugin = {
			name: 'owner',
			inject: ['regions'],
			apply(ctx: Context): void {
				ctx.effect(
					() =>
						ctx.regions.register({
							id: 'owner/late',
							region: 'left',
							component: Hello,
							props: { label: 'late' },
							order: 5
						}),
					'late'
				);
				ctx.effect(
					() =>
						ctx.regions.register({
							id: 'owner/early',
							region: 'left',
							component: Hello,
							props: { label: 'early' },
							order: -5
						}),
					'early'
				);
			}
		};
		await render(plugin, 'left');
		const labels = [...(target?.querySelectorAll('[data-testid=hello]') ?? [])].map(
			(node) => node.textContent
		);
		expect(labels).toEqual(['early', 'late']);
	});

	it('shows the empty state when the region has no contribution', async () => {
		const plugin = contributor('owner', []);
		await render(plugin, 'root', 'No layout plugin loaded');
		expect(target?.querySelector('[data-region-empty=root]')?.textContent).toContain(
			'No layout plugin loaded'
		);
	});

	it('replaces a contribution registered twice under the same id', async () => {
		const plugin = contributor('owner', [{ id: 'owner/hello', region: 'left', component: Hello }]);
		const { ctx } = await render(plugin, 'left');
		const second = ctx.regions.register({
			id: 'owner/hello',
			region: 'left',
			component: Hello,
			props: { label: 'second' }
		});
		flushSync();
		expect(target?.querySelectorAll('[data-testid=hello]')).toHaveLength(1);
		expect(target?.querySelector('[data-testid=hello]')?.textContent).toBe('second');
		second();
	});
});

describe('getKernel', () => {
	it('throws a descriptive error outside a component', () => {
		expect(() => getKernel()).toThrow(/outside a kernel host/);
	});

	it('throws a descriptive error in a component without a host', () => {
		const lonely = document.createElement('div');
		expect(() => mount(NoHost, { target: lonely })).toThrow(/outside a kernel host/);
	});
});

describePlugin('core-regions', coreRegions, {
	contributes: ({ ctx }) => {
		const dispose = ctx.regions.register({ id: 'probe', region: 'left', component: Hello });
		expect(ctx.regions.contributions('left').map((entry) => entry.id)).toEqual(['probe']);
		expect(ctx.regions.regionNames()).toEqual(['left']);
		dispose();
	}
});
