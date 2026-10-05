import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import designPanel from '../design-panel';
import inspectorPage from './index';

describePlugin('inspector-page', inspectorPage, {
	providers: [...panelProviders(), colorPicker],
	contributes: ({ ctx }) => {
		for (const id of ['page', 'variables', 'styles', 'export']) {
			expect(ctx.panels.sectionRegistry.get(`design/${id}`)).toBeDefined();
		}
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorPage, [designPanel, colorPicker]);
	return harness;
}

describe('page properties', () => {
	it('shows its sections only while nothing is selected', async () => {
		const panel = await open();
		expect(panel.sectionIds()).toEqual([
			'design/page',
			'design/variables',
			'design/styles',
			'design/export'
		]);
		panel.select(['a']);
		expect(panel.sectionIds()).toEqual([]);
	});

	it('edits the background color through the picker as an undoable change', async () => {
		const panel = await open();
		panel.click('button[aria-label="Page background"]');
		const request = panel.ctx.colorPicker.state.current;
		if (request === null) throw new Error('the picker did not open');
		request.onchange({ r: 1, g: 0, b: 0, a: 1 }, 'commit');
		expect(panel.ctx.document.currentPage.backgrounds[0]).toMatchObject({
			color: { r: 1, g: 0, b: 0 }
		});
		panel.undo();
		expect(panel.ctx.document.currentPage.backgrounds[0]).not.toMatchObject({
			color: { r: 1, g: 0, b: 0 }
		});
	});

	it('edits the background opacity', async () => {
		const panel = await open();
		panel.enter('Page background opacity', '40');
		expect(panel.ctx.document.currentPage.backgrounds[0]).toMatchObject({ opacity: 0.4 });
		panel.undo();
		expect(panel.ctx.document.currentPage.backgrounds[0]).toMatchObject({ opacity: 1 });
	});

	it('adds, edits and removes page export settings', async () => {
		const panel = await open();
		panel.click('button[aria-label="Add export setting"]');
		expect(panel.ctx.document.currentPage.exportSettings).toEqual([
			{ suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } }
		]);
		panel.enter('Export scale', '2');
		expect(panel.ctx.document.currentPage.exportSettings?.[0].constraint.value).toBe(2);
		panel.click('button[aria-label="Remove export setting"]');
		expect(panel.ctx.document.currentPage.exportSettings).toEqual([]);
		panel.undo();
		expect(panel.ctx.document.currentPage.exportSettings).toHaveLength(1);
	});

	it('lists collections and creates a new one', async () => {
		const panel = await open();
		expect(panel.query('[data-variables-section]')?.textContent).toContain('No variables yet');
		panel.click('button[aria-label="Add variable collection"]');
		expect(panel.query('[data-variable-collection]')?.textContent).toContain('Collection 1');
	});
});
