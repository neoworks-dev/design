import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import inspectorLayoutSize from './index';

describePlugin('inspector-layout-size', inspectorLayoutSize, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/layout-size')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorLayoutSize, [designPanel]);
	return harness;
}

describe('size section', () => {
	it('resizes with the proportion lock off and on', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.field('Width').value).toBe('10');
		panel.enter('Width', '40');
		expect(panel.ctx.document.require('a')).toMatchObject({ width: 40, height: 10 });
		panel.undo();
		panel.setProps('a', { constrainProportions: true });
		panel.enter('Width', '40');
		expect(panel.ctx.document.require('a')).toMatchObject({ width: 40, height: 40 });
	});

	it('shows Mixed for different sizes and applies one value to all', async () => {
		const panel = await open();
		panel.setProps('b', { width: 30 });
		panel.select(['a', 'b']);
		expect(panel.field('Width').placeholder).toBe('Mixed');
		panel.enter('Width', '12');
		expect(panel.ctx.document.require('a')).toMatchObject({ width: 12 });
		expect(panel.ctx.document.require('b')).toMatchObject({ width: 12 });
	});

	it('shows resizing only where hug or fill can apply and disables the invalid options', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.query('[data-resizing-row]')).toBeNull();
		panel.setProps('f', { layoutMode: 'VERTICAL' });
		const buttons = [
			...(panel
				.query('[data-resizing-row]')
				?.querySelectorAll<HTMLButtonElement>('[data-toggle-group="Horizontal resizing"] button') ??
				[])
		];
		expect(buttons.map((button) => button.disabled)).toEqual([false, true, false]);
		expect(buttons[1].title).toContain('Hug needs');
		buttons[2].click();
		flushSync();
		expect(panel.ctx.document.require('a')).toMatchObject({ layoutSizingHorizontal: 'FILL' });
	});

	it('edits min and max, clearing them with empty text', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'VERTICAL' });
		panel.select(['a']);
		panel.enter('Minimum width', '5');
		expect(panel.ctx.document.require('a')).toMatchObject({ minWidth: 5 });
		panel.enter('Minimum width', '');
		expect(panel.ctx.document.require('a')).toMatchObject({ minWidth: null });
	});

	it('edits constraints of frame children and clip content of frames', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.query('[data-constraints]')).not.toBeNull();
		panel.select(['f']);
		expect(panel.query('[data-constraints]')).toBeNull();
		const clip = panel.query<HTMLInputElement>('input[aria-label="Clip content"]');
		clip?.click();
		flushSync();
		expect(panel.ctx.document.require('f')).toMatchObject({ clipsContent: false });
	});
});
