import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness } from '../../lib/editing/fixtures/panelHarness';
import autolayout from '../autolayout';
import { fakeTextLayout } from '../autolayout/fixtures/autolayoutFixture';
import designPanel from '../design-panel';
import inspectorAutolayout from './index';

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorAutolayout, [
		designPanel,
		fakeTextLayout(),
		autolayout
	]);
	return harness;
}

function press(panel: PanelHarness, label: string): void {
	panel.click(`button[aria-label="${label}"]`);
}

function geometry(panel: PanelHarness, id: string): Record<string, number> {
	const node = panel.ctx.document.require(id);
	if (node.type === 'PAGE') throw new Error('page');
	return {
		x: node.transform[0][2],
		y: node.transform[1][2],
		width: node.width,
		height: node.height
	};
}

describe('auto layout section', () => {
	it('shows for frames only, not for plain children of auto layout frames', async () => {
		const panel = await open();
		panel.select(['loose']);
		expect(panel.query('[data-toggle-group="Flow"]')).toBeNull();
		panel.select(['a']);
		expect(panel.query('[data-toggle-group="Flow"]')).toBeNull();
		panel.setProps('f', { layoutMode: 'HORIZONTAL' });
		expect(panel.query('[data-toggle-group="Flow"]')).toBeNull();
		panel.select(['f']);
		expect(panel.query('[data-toggle-group="Flow"]')).not.toBeNull();
		expect(panel.query('[data-toggle-group="Flow"]')).not.toBeNull();
	});

	it('turns auto layout on with the flow buttons, infers it and undoes in one step', async () => {
		const panel = await open();
		panel.select(['f']);
		expect(panel.query('[data-autolayout-controls]')).toBeNull();
		press(panel, 'Horizontal');
		expect(panel.ctx.document.require('f')).toMatchObject({ layoutMode: 'HORIZONTAL' });
		expect(panel.query('[data-autolayout-controls]')).not.toBeNull();
		expect(geometry(panel, 'a')).toMatchObject({ x: 0, y: 0 });
		expect(geometry(panel, 'b')).toMatchObject({ x: 20, y: 0 });
		press(panel, 'Vertical');
		expect(panel.ctx.document.require('f')).toMatchObject({ layoutMode: 'VERTICAL' });
		press(panel, 'Wrap');
		expect(panel.ctx.document.require('f')).toMatchObject({
			layoutMode: 'HORIZONTAL',
			layoutWrap: 'WRAP'
		});
		panel.undo();
		expect(panel.ctx.document.require('f')).toMatchObject({ layoutMode: 'VERTICAL' });
		press(panel, 'Freeform');
		expect(panel.ctx.document.require('f')).toMatchObject({ layoutMode: 'NONE' });
		expect(panel.query('[data-autolayout-controls]')).toBeNull();
	});

	it('sets spacing, which lays the children out again', async () => {
		const panel = await open();
		panel.setProps('f', {
			layoutMode: 'HORIZONTAL',
			layoutSizingHorizontal: 'HUG',
			layoutSizingVertical: 'HUG'
		});
		panel.select(['f']);
		panel.enter('Item spacing', '12');
		expect(geometry(panel, 'b').x).toBe(22);
		expect(geometry(panel, 'c').x).toBe(44);
		expect(geometry(panel, 'f').width).toBe(54);
		panel.undo();
		expect(geometry(panel, 'b').x).toBe(10);
	});

	it('toggles auto spacing and shows Auto in the empty field', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', width: 200 });
		panel.select(['f']);
		press(panel, 'Auto spacing');
		expect(panel.ctx.document.require('f')).toMatchObject({
			primaryAxisAlignItems: 'SPACE_BETWEEN'
		});
		expect(panel.field('Item spacing').placeholder).toBe('Auto');
		expect(geometry(panel, 'c').x).toBe(190);
		panel.enter('Item spacing', '4');
		expect(panel.ctx.document.require('f')).toMatchObject({
			primaryAxisAlignItems: 'MIN',
			itemSpacing: 4
		});
	});

	it('edits padding uniformly and per side', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL' });
		panel.select(['f']);
		panel.enter('Horizontal padding', '8');
		expect(panel.ctx.document.require('f')).toMatchObject({ paddingLeft: 8, paddingRight: 8 });
		expect(geometry(panel, 'a').x).toBe(8);
		panel.enter('Vertical padding', '3');
		expect(panel.ctx.document.require('f')).toMatchObject({ paddingTop: 3, paddingBottom: 3 });
		press(panel, 'Padding per side');
		panel.enter('Padding top', '5');
		expect(panel.ctx.document.require('f')).toMatchObject({ paddingTop: 5, paddingBottom: 3 });
		panel.undo();
		expect(panel.ctx.document.require('f')).toMatchObject({ paddingTop: 3 });
	});

	it('shows per-side padding on its own when the sides differ', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', paddingLeft: 4 });
		panel.select(['f']);
		expect(panel.field('Padding left').value).toBe('4');
		expect(panel.field('Padding right').value).toBe('0');
	});

	it('picks alignment from the grid for either direction', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', width: 100, height: 60 });
		panel.select(['f']);
		press(panel, 'Align bottom right');
		expect(panel.ctx.document.require('f')).toMatchObject({
			primaryAxisAlignItems: 'MAX',
			counterAxisAlignItems: 'MAX'
		});
		expect(geometry(panel, 'c')).toMatchObject({ x: 90, y: 50 });
		press(panel, 'Vertical');
		press(panel, 'Align top right');
		expect(panel.ctx.document.require('f')).toMatchObject({
			primaryAxisAlignItems: 'MIN',
			counterAxisAlignItems: 'MAX'
		});
	});

	it('keeps space between when a grid cell is picked', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN' });
		panel.select(['f']);
		press(panel, 'Align bottom center');
		expect(panel.ctx.document.require('f')).toMatchObject({
			primaryAxisAlignItems: 'SPACE_BETWEEN',
			counterAxisAlignItems: 'MAX'
		});
	});

	it('shows the row spacing while wrapping', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' });
		panel.select(['f']);
		panel.enter('Row spacing', '9');
		expect(panel.ctx.document.require('f')).toMatchObject({ counterAxisSpacing: 9 });
		expect(panel.field('Row spacing').value).toBe('9');
	});

	it('toggles strokes in layout', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL' });
		panel.select(['f']);
		const checkbox = panel.query<HTMLInputElement>('[data-strokes-included] input');
		checkbox?.click();
		flushSync();
		expect(panel.ctx.document.require('f')).toMatchObject({ strokesIncludedInLayout: true });
	});
});
