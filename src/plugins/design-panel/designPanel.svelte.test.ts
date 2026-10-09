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
	it('names the selection by its type in the header', async () => {
		harness = await PanelHarness.create(designPanel);
		expect(harness.query('[data-node-header]')?.textContent).toContain('Page');
		harness.select(['a']);
		const type = harness.ctx.document.require('a').type;
		expect(harness.query('[data-node-header]')?.textContent?.toLowerCase()).toContain(
			type.toLowerCase()
		);
		harness.select(['a', 'b']);
		expect(harness.query('[data-node-header]')?.textContent).toContain('2 layers');
	});

	it('shows sections Figma-style: a fixed title and the body, no collapse toggle', async () => {
		harness = await PanelHarness.create(designPanel, [inspectorPage, colorPicker]);
		const section = harness.query('[data-panel-section="design/page"]');
		expect(section?.querySelector('h2')?.textContent).toContain('Page');
		expect(section?.querySelector('button[aria-expanded]')).toBeNull();
		expect(section?.querySelector('[data-panel-section-body]')).not.toBeNull();
	});
});
