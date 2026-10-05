import type { Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import commandPalette from '../command-palette';
import paletteSources from './index';

const zoomToSelection = vi.fn();

const fakeViewport: Plugin = {
	name: 'fake-viewport',
	inject: [],
	apply(ctx) {
		ctx.provide('viewport', { zoomToSelection });
	}
};

function providers(): Plugin[] {
	return [...editingProviders(), commandPalette, fakeViewport];
}

describePlugin('palette-sources', paletteSources, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.palette.sourceList().map((source) => source.id)).toEqual([
			'commands',
			'pages',
			'layers'
		]);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	zoomToSelection.mockClear();
});

describe('palette sources', () => {
	it('lists pages and switches to the chosen one', async () => {
		mounted = await mountPlugin(paletteSources, { providers: providers() });
		const { ctx } = mounted;
		ctx.palette.open('pages');
		const rows = ctx.palette.rows();
		expect(rows.map((row) => row.item.title)).toEqual(['Page']);
		await ctx.palette.runSelected();
		expect(ctx.document.currentPageId).toBe('p');
	});

	it('finds layers by name, selects the chosen one and zooms to it', async () => {
		mounted = await mountPlugin(paletteSources, { providers: providers() });
		const { ctx } = mounted;
		ctx.palette.open('layers');
		ctx.palette.setQuery('loose');
		expect(ctx.palette.rows().map((row) => row.item.id)).toEqual(['loose']);
		await ctx.palette.runSelected();
		expect(ctx.selection.ids).toEqual(['loose']);
		expect(zoomToSelection).toHaveBeenCalledTimes(1);
	});
});
