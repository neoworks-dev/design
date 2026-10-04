import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreInspectors from '../../plugins/core-inspectors';
import coreKeymap from '../../plugins/core-keymap';
import corePanels from '../../plugins/core-panels';
import coreRegions from '../../plugins/core-regions';
import PlaceholderText from '../../plugins/placeholder-shell/PlaceholderText.svelte';
import { createNode, type Node } from '../document';
import { MIXED } from '../inspectors/selection';
import HostRoot from '../kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';

class FakeSelectionState {
	nodes = $state.raw<readonly Node[]>([]);
}

const storage = { getItem: (): null => null, setItem: (): void => {} };
const panelsPlugin = { ...corePanels, apply: (ctx: never) => corePanels.apply(ctx, { storage }) };
const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, panelsPlugin];

function selectionPlugin(state: FakeSelectionState): {
	name: string;
	inject: string[];
	apply: (ctx: never) => void;
} {
	return {
		name: 'selection',
		inject: [],
		apply: (ctx: { provide: (name: string, value: unknown) => void }) =>
			ctx.provide('selection', { nodes: () => state.nodes })
	};
}

const rectangle = (id: string, opacity = 1): Node => createNode('RECTANGLE', { id, opacity });

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

async function mountInspectors(state = new FakeSelectionState()): Promise<MountedPlugin> {
	mounted = await mountPlugin(
		{ name: 'consumer', inject: ['inspectors', 'panels'], apply(): void {} },
		{ providers: [...providers, selectionPlugin(state), coreInspectors] }
	);
	return mounted;
}

describe('inspectors', () => {
	it('shows a section only while applies holds, and follows selection changes', async () => {
		const state = new FakeSelectionState();
		const { ctx } = await mountInspectors(state);
		ctx.inspectors.register({
			id: 'text',
			tab: 'design',
			title: 'Text',
			applies: (selection) => selection.hasText,
			component: PlaceholderText,
			props: { text: 'text section' }
		});
		ctx.inspectors.register({
			id: 'layout',
			tab: 'design',
			title: 'Layout',
			order: 5,
			applies: (selection) => selection.count > 0,
			component: PlaceholderText
		});
		const visible = (): string[] => ctx.panels.sections('design').map((section) => section.id);
		expect(visible()).toEqual([]);

		state.nodes = [rectangle('a')];
		expect(visible()).toEqual(['design/layout']);

		state.nodes = [rectangle('a'), createNode('TEXT', { id: 't' })];
		expect(visible()).toEqual(['design/text', 'design/layout']);

		state.nodes = [];
		expect(visible()).toEqual([]);
	});

	it('renders the section in the sidebar and removes it on dispose', async () => {
		const state = new FakeSelectionState();
		const { ctx } = await mountInspectors(state);
		ctx.panels.registerTab({ id: 'design', side: 'right', title: 'Design' });
		const dispose = ctx.inspectors.register({
			id: 'fill',
			tab: 'design',
			title: 'Fill',
			applies: (selection) => selection.kind === 'RECTANGLE',
			component: PlaceholderText,
			props: { text: 'fill body' }
		});
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'right' } });
		flushSync();
		expect(target.textContent).not.toContain('fill body');

		state.nodes = [rectangle('a')];
		flushSync();
		expect(target.textContent).toContain('fill body');

		dispose();
		flushSync();
		expect(target.textContent).not.toContain('fill body');
		expect(ctx.inspectors.registry.listAll()).toEqual([]);
	});

	it('hides a section whose applies throws instead of breaking the panel', async () => {
		const { ctx } = await mountInspectors();
		ctx.inspectors.register({
			id: 'broken',
			tab: 'design',
			title: 'Broken',
			applies: () => {
				throw new Error('boom');
			},
			component: PlaceholderText
		});
		expect(ctx.panels.sections('design')).toEqual([]);
	});

	it('summarizes the connected selection and lists the applicable inspectors', async () => {
		const state = new FakeSelectionState();
		const { ctx } = await mountInspectors(state);
		ctx.inspectors.register({
			id: 'multi',
			tab: 'design',
			title: 'Multi',
			applies: (selection) => selection.count > 1,
			component: PlaceholderText
		});
		state.nodes = [rectangle('a'), rectangle('b')];
		expect(ctx.inspectors.summary()).toMatchObject({ count: 2, kind: 'RECTANGLE' });
		expect(ctx.inspectors.activeIds()).toEqual(['multi']);
	});

	it('property() reads across the selection with MIXED and writes through the callback', async () => {
		const state = new FakeSelectionState();
		const { ctx } = await mountInspectors(state);
		const written: unknown[] = [];
		const opacity = ctx.inspectors.property(
			(node) => (node.type === 'RECTANGLE' ? node.opacity : 1),
			(nodes, value) => void written.push([nodes.map((node) => node.id), value])
		);
		expect(opacity.value).toBeUndefined();

		state.nodes = [rectangle('a', 0.5), rectangle('b', 0.5)];
		expect(opacity.value).toBe(0.5);
		expect(opacity.isMixed).toBe(false);

		state.nodes = [rectangle('a', 0.5), rectangle('b', 1)];
		expect(opacity.value).toBe(MIXED);
		expect(opacity.isMixed).toBe(true);

		opacity.set(0.25);
		expect(written).toEqual([[['a', 'b'], 0.25]]);
	});

	it('works without a selection service and picks it up when it appears', async () => {
		mounted = await mountPlugin(
			{ name: 'consumer', inject: ['inspectors'], apply(): void {} },
			{ providers: [...providers, coreInspectors] }
		);
		const { ctx } = mounted;
		expect(ctx.inspectors.summary().count).toBe(0);
		const state = new FakeSelectionState();
		state.nodes = [rectangle('a')];
		await ctx.plugin(selectionPlugin(state));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ctx.inspectors.summary().count).toBe(1);
	});

	it('a stale source disposer does not disconnect its replacement', async () => {
		const { ctx } = await mountInspectors();
		const first = ctx.inspectors.setSelectionSource({ nodes: () => [rectangle('a')] });
		ctx.inspectors.setSelectionSource({ nodes: () => [rectangle('b'), rectangle('c')] });
		first();
		expect(ctx.inspectors.nodes()).toHaveLength(2);
	});
});

describePlugin('core-inspectors', coreInspectors, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.inspectors).toBeDefined();
		expect(ctx.inspectors.summary().kind).toBe('none');
	}
});
