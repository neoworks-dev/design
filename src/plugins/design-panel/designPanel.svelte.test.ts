import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import inspectorPage from '../inspector-page';
import designPanel from './index';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';

describePlugin('design-panel', designPanel, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.getTab('design')?.side).toBe('right');
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

describe('design panel shell', () => {
	it('names the selection in the header', async () => {
		harness = await PanelHarness.create(designPanel);
		expect(harness.query('[data-node-header]')?.textContent).toContain('Page');
		harness.select(['a']);
		expect(harness.query('[data-node-header]')?.textContent).toContain('a');
		harness.select(['a', 'b']);
		expect(harness.query('[data-node-header]')?.textContent).toContain('2 layers');
	});

	it('remembers collapsed sections', async () => {
		harness = await PanelHarness.create(designPanel, [inspectorPage, colorPicker]);
		const header = harness.query<HTMLButtonElement>(
			'[data-panel-section="design/page"] button[aria-expanded]'
		);
		header?.click();
		expect(harness.ctx.panels.state.sectionStates['design/page']).toBe(true);
	});
});
