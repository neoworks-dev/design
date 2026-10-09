import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import inspectorAppearance from './index';

describePlugin('inspector-appearance', inspectorAppearance, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/appearance')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorAppearance, [designPanel]);
	return harness;
}

describe('appearance section', () => {
	it('edits opacity through the opacity command and undoes it', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.field('Opacity').value).toBe('100');
		panel.enter('Opacity', '50');
		expect(panel.ctx.document.require('a')).toMatchObject({ opacity: 0.5 });
		panel.undo();
		expect(panel.ctx.document.require('a')).toMatchObject({ opacity: 1 });
		expect(panel.field('Opacity').value).toBe('100');
	});

	it('shows Mixed opacity for diverging values', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.enter('Opacity', '50');
		panel.select(['a', 'b']);
		expect(panel.field('Opacity').placeholder).toBe('Mixed');
	});

	it('edits uniform and per-corner radius', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.enter('Corner radius', '4');
		expect(panel.ctx.document.require('a')).toMatchObject({ cornerRadius: 4 });
		panel.click('button[aria-label="Independent corners"]');
		panel.enter('Top right', '9');
		expect(panel.ctx.document.require('a')).toMatchObject({ cornerRadius: [4, 9, 4, 4] });
		panel.undo();
		panel.undo();
		expect(panel.ctx.document.require('a')).toMatchObject({ cornerRadius: 0 });
	});

	it('edits corner smoothing in percent', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Independent corners"]');
		panel.enter('Corner smoothing', '60');
		expect(panel.ctx.document.require('a')).toMatchObject({ cornerSmoothing: 0.6 });
	});

	it('toggles visibility and mask through their commands', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Visibility"]');
		expect(panel.ctx.document.require('a')).toMatchObject({ visible: false });
		panel.click('button[aria-label="Use as mask"]');
		expect(panel.ctx.document.require('a')).toMatchObject({ isMask: true });
	});

	it('sets the mask type through the mask commands', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Use as mask"]');
		await panel.ctx.commands.run('mask.type-luminance');
		expect(panel.ctx.document.require('a')).toMatchObject({ maskType: 'LUMINANCE' });
	});

	it('shows the blend mode and Mixed when modes differ', async () => {
		const panel = await open();
		panel.setProps('b', { blendMode: 'MULTIPLY' });
		panel.select(['a']);
		panel.click('button[aria-label="Blend mode"]');
		expect(panel.query('[data-blend-mode]')?.textContent).toContain('Pass through');
		panel.select(['b']);
		expect(panel.query('[data-blend-mode]')?.textContent).toContain('Multiply');
		panel.select(['a', 'b']);
		expect(panel.query('[data-blend-mode]')?.textContent).toContain('Mixed');
	});
});
