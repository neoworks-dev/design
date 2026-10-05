import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Paint, RGBA } from '../../lib/document';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import designPanel from '../design-panel';
import { collectColors, planColorReplacement } from './colors';
import inspectorSelectionColors from './index';

describePlugin('inspector-selection-colors', inspectorSelectionColors, {
	providers: [...panelProviders(), colorPicker],
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/selection-colors')).toBeDefined();
	}
});

function solid(r: number, g: number, b: number): Paint {
	return { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r, g, b } };
}

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorSelectionColors, [designPanel, colorPicker]);
	harness.setProps('a', { fills: [solid(1, 0, 0)] });
	harness.setProps('b', { fills: [solid(1, 0, 0)] });
	harness.setProps('c', { fills: [solid(0, 0, 1)] });
	return harness;
}

function pick(panel: PanelHarness, name: string, color: RGBA): void {
	panel.click(`button[aria-label="${name}"]`);
	const request = panel.ctx.colorPicker.state.current;
	if (request === null) throw new Error('the picker did not open');
	request.onchange(color, 'scrub');
	flushSync();
}

describe('selection colors section', () => {
	it('lists the colors below the selection with usage counts', async () => {
		const panel = await open();
		panel.select(['f']);
		expect(panel.query('[data-color-row="hex:#ff0000"]')?.textContent).toContain('2');
		expect(panel.query('[data-color-row="hex:#0000ff"]')).not.toBeNull();
	});

	it('replaces a color in every usage and undoes it in one step', async () => {
		const panel = await open();
		panel.select(['f']);
		pick(panel, 'Replace #ff0000', { r: 0, g: 1, b: 0, a: 1 });
		for (const id of ['a', 'b']) {
			expect(panel.ctx.document.require(id)).toMatchObject({
				fills: [{ color: { r: 0, g: 1, b: 0 } }]
			});
		}
		expect(panel.ctx.document.require('c')).toMatchObject({ fills: [{ color: { b: 1 } }] });
		panel.undo();
		for (const id of ['a', 'b']) {
			expect(panel.ctx.document.require(id)).toMatchObject({ fills: [{ color: { r: 1 } }] });
		}
	});
});

describe('color collection', () => {
	it('keys bound paints by variable and replaces them detached', () => {
		const bound: Paint = {
			...solid(0, 0, 0),
			boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'v1' } }
		};
		const node = { id: 'n', type: 'RECTANGLE', fills: [bound, solid(1, 1, 1)], strokes: [] };
		const rows = collectColors([node as never]);
		expect(rows.map((row) => row.key)).toEqual(['var:v1', 'hex:#ffffff']);
		const plan = planColorReplacement([node as never], 'var:v1', { r: 1, g: 0, b: 0 });
		const fills = plan.get('n')?.fills as Paint[];
		expect(fills[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
		expect(fills[0].boundVariables).toBeUndefined();
	});
});
