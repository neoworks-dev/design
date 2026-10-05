import { afterEach, describe, expect, it } from 'vitest';
import type { Stroke } from '../../lib/document';
import { defaultStroke, newPaint } from '../../lib/editing/paints';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import coreTools from '../core-tools';
import designPanel from '../design-panel';
import gradientEditor from '../gradient-editor';
import overlay from '../overlay';
import inspectorStroke from './index';

const dependencies = [designPanel, colorPicker, coreTools, overlay, gradientEditor];

describePlugin('inspector-stroke', inspectorStroke, {
	providers: [...panelProviders(), colorPicker, coreTools, overlay, gradientEditor],
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/stroke')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorStroke, dependencies);
	return harness;
}

function strokesOf(panel: PanelHarness, id: string): Stroke[] {
	const node = panel.ctx.document.require(id);
	if (!('strokes' in node)) throw new Error(`${id} has no strokes`);
	return node.strokes;
}

describe('stroke section', () => {
	it('adds a default stroke with the first paint and undoes it', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add stroke"]');
		expect(strokesOf(panel, 'a')).toHaveLength(1);
		expect(strokesOf(panel, 'a')[0]).toMatchObject({
			weight: 1,
			align: 'INSIDE',
			paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
		});
		panel.undo();
		expect(strokesOf(panel, 'a')).toHaveLength(0);
	});

	it('removing the last stroke paint removes the stroke', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add stroke"]');
		panel.click('button[aria-label="Remove stroke 1"]');
		expect(strokesOf(panel, 'a')).toHaveLength(0);
	});

	it('edits weight and position', async () => {
		const panel = await open();
		panel.setProps('a', { strokes: [defaultStroke([newPaint('stroke')])] });
		panel.select(['a']);
		panel.enter('Stroke weight', '4');
		expect(strokesOf(panel, 'a')[0].weight).toBe(4);
		panel.click('button[aria-label="Outside"]');
		expect(strokesOf(panel, 'a')[0].align).toBe('OUTSIDE');
	});

	it('toggles per-side weights and edits one side', async () => {
		const panel = await open();
		panel.setProps('a', { strokes: [{ ...defaultStroke([newPaint('stroke')]), weight: 3 }] });
		panel.select(['a']);
		panel.click('button[aria-label="Independent stroke weights"]');
		expect(strokesOf(panel, 'a')[0].weight).toEqual({ top: 3, right: 3, bottom: 3, left: 3 });
		panel.enter('Left weight', '8');
		expect(strokesOf(panel, 'a')[0].weight).toEqual({ top: 3, right: 3, bottom: 3, left: 8 });
		panel.click('button[aria-label="Independent stroke weights"]');
		expect(strokesOf(panel, 'a')[0].weight).toBe(8);
	});

	it('edits dash, ends and join in the advanced popover', async () => {
		const panel = await open();
		panel.setProps('a', { strokes: [defaultStroke([newPaint('stroke')])] });
		panel.select(['a']);
		panel.click('button[aria-label="Advanced stroke settings"]');
		panel.click('button[aria-label="Dash"][aria-pressed]');
		expect(strokesOf(panel, 'a')[0].dashPattern).toEqual([10, 10]);
		panel.enter('Gap', '4');
		expect(strokesOf(panel, 'a')[0].dashPattern).toEqual([10, 4]);
		panel.click('button[aria-label="Round"][aria-pressed]');
		expect(strokesOf(panel, 'a')[0].cap).toBe('ROUND');
		panel.click('button[aria-label="Bevel"]');
		expect(strokesOf(panel, 'a')[0].join).toBe('BEVEL');
	});

	it('Shift+/ command removes the strokes', async () => {
		const panel = await open();
		panel.setProps('a', { strokes: [defaultStroke([newPaint('stroke')])] });
		panel.select(['a']);
		await panel.ctx.commands.run('stroke.remove');
		expect(strokesOf(panel, 'a')).toHaveLength(0);
	});
});
