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

	it('offers only the resizing modes that apply, as icons with tooltips', async () => {
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
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Fixed size',
			'Fill container'
		]);
		expect(buttons.every((button) => button.title !== '' && button.querySelector('svg'))).toBe(
			true
		);
		buttons[1].click();
		flushSync();
		expect(panel.ctx.document.require('a')).toMatchObject({ layoutSizingHorizontal: 'FILL' });
	});

	it('adds min and max through a menu and shows them only once set', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'VERTICAL' });
		panel.select(['a']);
		expect(panel.query('[data-limits]')).toBeNull();
		panel.click('button[aria-label="Add min or max size"]');
		const items = [...(panel.query('[data-limit-menu]')?.querySelectorAll('button') ?? [])];
		expect(items.map((item) => item.textContent?.trim())).toEqual([
			'Add minimum width',
			'Add maximum width',
			'Add minimum height',
			'Add maximum height'
		]);
		items[0].click();
		flushSync();
		expect(panel.query('[data-limit-menu]')).toBeNull();
		panel.enter('Minimum width', '5');
		expect(panel.ctx.document.require('a')).toMatchObject({ minWidth: 5 });
		panel.enter('Minimum width', '');
		expect(panel.ctx.document.require('a')).toMatchObject({ minWidth: null });
	});

	it('the constraint widget pins sides, stretches with both bars and centres', async () => {
		const panel = await open();
		panel.select(['a']);
		const press = (bar: string): void => {
			panel.query<HTMLButtonElement>(`[data-bar="${bar}"]`)?.click();
			flushSync();
		};
		const constraints = (): unknown => panel.ctx.document.require('a');
		press('right');
		expect(constraints()).toMatchObject({ constraints: { horizontal: 'STRETCH' } });
		press('left');
		expect(constraints()).toMatchObject({ constraints: { horizontal: 'MAX' } });
		press('bottom');
		expect(constraints()).toMatchObject({ constraints: { vertical: 'STRETCH' } });
		press('center-horizontal');
		expect(constraints()).toMatchObject({ constraints: { horizontal: 'CENTER' } });
		press('center-vertical');
		expect(constraints()).toMatchObject({ constraints: { vertical: 'CENTER' } });
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
