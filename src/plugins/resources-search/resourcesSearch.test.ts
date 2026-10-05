import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import assetsPanel from '../assets-panel';
import { assetsProviders } from '../assets-panel/fixtures/assetsFixture';
import resourcesSearch from './index';

// The assets panel provides `assetsPanel`, the palette the overlay; both are providers here.
// A fresh document per mount: the providers are built at call time.
function providers(): Plugin[] {
	return [...assetsProviders({ palette: true }), assetsPanel];
}

describePlugin('resources-search', resourcesSearch, {
	providers: providers(),
	contributes: ({ ctx, currentState }) => {
		expect(ctx.commands.has('resources.search')).toBe(true);
		expect(ctx.palette.sourceList().map((source) => source.id)).toContain('resources');
		expect(currentState().registries['keymap.registry']).toContain(
			'resources-search|global|shift+i|resources.search'
		);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(resourcesSearch, { providers: providers() });
	return mounted.ctx;
}

function titles(ctx: Context): string[] {
	return ctx.palette.rows().map((row) => row.item.title);
}

describe('the Resources quick search', () => {
	it('Shift+I opens the palette on the Resources tab listing every component', async () => {
		const ctx = await open();
		await ctx.commands.run('resources.search');
		expect(ctx.palette.isOpen).toBe(true);
		expect(ctx.palette.sourceId).toBe('resources');
		expect(titles(ctx).sort()).toEqual(['Button/Primary', 'Card', 'Icon']);
	});

	it('filters while typing and Enter inserts the highlighted result', async () => {
		const ctx = await open();
		ctx.selection.select(['f']);
		await ctx.commands.run('resources.search');
		ctx.palette.setQuery('prim');
		expect(titles(ctx)).toEqual(['Button/Primary']);
		const steps = ctx.history.entries.length;
		await ctx.palette.runSelected();
		const [instance] = ctx.document.query((node) => node.type === 'INSTANCE');
		expect(instance).toMatchObject({ mainComponentId: 'm-primary', parentId: 'f' });
		expect(ctx.palette.isOpen).toBe(false);
		expect(ctx.history.entries).toHaveLength(steps + 1);
		expect(ctx.selection.ids).toEqual([instance.id]);
	});

	it('greys out and does not insert a component that would contain itself', async () => {
		const ctx = await open();
		ctx.selection.select(['m-host-inner']);
		await ctx.commands.run('resources.search');
		ctx.palette.setQuery('card');
		const [row] = ctx.palette.rows();
		expect(row.item.enabled).toBe(false);
		await ctx.palette.runSelected();
		expect(ctx.document.query((node) => node.type === 'INSTANCE')).toHaveLength(0);
	});
});
