import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { LayoutGrid } from '../../lib/document';
import { PanelHarness } from '../../lib/editing/fixtures/panelHarness';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import colorPicker from '../color-picker';
import designPanel from '../design-panel';
import layoutGrids from './index';

const fakeSnapping = {
	name: 'snapping',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('snapping', { addLineSource: () => () => {} })
} as Plugin;

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(layoutGrids, [
		designPanel,
		colorPicker,
		fakeOverlay,
		fakeSnapping
	]);
	return harness;
}

function gridsOf(panel: PanelHarness, id: string): LayoutGrid[] {
	const node = panel.ctx.document.require(id);
	if (!('layoutGrids' in node)) throw new Error('no grids');
	return node.layoutGrids;
}

describe('layout guide section', () => {
	it('shows for a frame only', async () => {
		const panel = await open();
		panel.select(['f']);
		expect(panel.sectionIds()).toContain('design/layout-grid');
		panel.select(['a']);
		expect(panel.sectionIds()).not.toContain('design/layout-grid');
	});

	it('adds, edits, hides and removes grids, each as an undoable step', async () => {
		const panel = await open();
		panel.select(['f']);
		panel.click('button[aria-label="Add layout grid"]');
		expect(gridsOf(panel, 'f')).toHaveLength(1);
		expect(gridsOf(panel, 'f')[0]).toMatchObject({ pattern: 'COLUMNS', count: 5 });

		panel.enter('Grid count', '12');
		expect(gridsOf(panel, 'f')[0].count).toBe(12);
		panel.enter('Grid gutter', '8');
		expect(gridsOf(panel, 'f')[0].gutterSize).toBe(8);

		panel.click('button[aria-label="Toggle grid 1 visibility"]');
		expect(gridsOf(panel, 'f')[0].visible).toBe(false);

		panel.click('button[aria-label="Add layout grid"]');
		expect(gridsOf(panel, 'f')).toHaveLength(2);
		panel.click('button[aria-label="Remove grid 2"]');
		expect(gridsOf(panel, 'f')).toHaveLength(1);
		panel.undo();
		expect(gridsOf(panel, 'f')).toHaveLength(2);
	});

	it('changes the grid color through the picker', async () => {
		const panel = await open();
		panel.select(['f']);
		panel.click('button[aria-label="Add layout grid"]');
		panel.click('button[aria-label="Grid 1 color"]');
		const request = panel.ctx.colorPicker.state.current;
		if (request === null) throw new Error('the picker did not open');
		request.onchange({ r: 0, g: 0, b: 1, a: 0.2 }, 'commit');
		expect(gridsOf(panel, 'f')[0].color).toEqual({ r: 0, g: 0, b: 1, a: 0.2 });
	});

	it('switches the pattern and shows the size field for a square grid', async () => {
		const panel = await open();
		panel.select(['f']);
		panel.click('button[aria-label="Add layout grid"]');
		expect(panel.query('input[aria-label="Grid size"]')).toBeNull();
		panel.ctx.document.apply(
			panel.ctx.document.setProps('f', {
				layoutGrids: [{ ...gridsOf(panel, 'f')[0], pattern: 'GRID' }]
			}),
			{ origin: 'user', label: 'Switch pattern' }
		);
		panel.select(['f']);
		expect(panel.query('input[aria-label="Grid size"]')).not.toBeNull();
	});
});
