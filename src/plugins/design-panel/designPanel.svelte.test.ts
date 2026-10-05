import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from './index';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';

describePlugin('design-panel', designPanel, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.getTab('design')?.side).toBe('right');
		expect(ctx.panels.sections('design').map((section) => section.id)).toContain('design/page');
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

describe('design panel shell', () => {
	it('shows the page section only while nothing is selected', async () => {
		harness = await PanelHarness.create(designPanel);
		expect(harness.sectionIds()).toEqual(['design/page']);
		harness.select(['a']);
		expect(harness.sectionIds()).toEqual([]);
		harness.select([]);
		expect(harness.sectionIds()).toEqual(['design/page']);
	});

	it('names the selection in the header', async () => {
		harness = await PanelHarness.create(designPanel);
		expect(harness.query('[data-node-header]')?.textContent).toContain('Page');
		harness.select(['a']);
		expect(harness.query('[data-node-header]')?.textContent).toContain('a');
		harness.select(['a', 'b']);
		expect(harness.query('[data-node-header]')?.textContent).toContain('2 layers');
	});

	it('remembers collapsed sections', async () => {
		harness = await PanelHarness.create(designPanel);
		const header = harness.query<HTMLButtonElement>(
			'[data-panel-section="design/page"] button[aria-expanded]'
		);
		header?.click();
		expect(harness.ctx.panels.state.sectionStates['design/page']).toBe(true);
	});

	it('edits the page background as an undoable change', async () => {
		harness = await PanelHarness.create(designPanel);
		const swatch = harness.query<HTMLInputElement>('input[aria-label="Page background"]');
		if (!swatch) throw new Error('no swatch');
		swatch.value = '#ff0000';
		swatch.dispatchEvent(new Event('input', { bubbles: true }));
		expect(harness.ctx.document.currentPage.backgrounds[0]).toMatchObject({
			color: { r: 1, g: 0, b: 0 }
		});
		expect(harness.ctx.history.undo()).toBe(true);
		expect(harness.ctx.document.currentPage.backgrounds[0]).not.toMatchObject({
			color: { r: 1, g: 0, b: 0 }
		});
	});
});
