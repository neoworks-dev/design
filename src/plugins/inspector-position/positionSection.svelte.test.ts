import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import inspectorPosition from './index';

describePlugin('inspector-position', inspectorPosition, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/position')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorPosition, [designPanel]);
	return harness;
}

describe('position section', () => {
	it('shows with a selection only', async () => {
		const panel = await open();
		expect(panel.sectionIds()).toEqual([]);
		panel.select(['a']);
		expect(panel.sectionIds()).toEqual(['design/position']);
	});

	it('shows Mixed for diverging values and sets all of them from one edit', async () => {
		const panel = await open();
		panel.select(['a', 'b']);
		expect(panel.field('X position').placeholder).toBe('Mixed');
		expect(panel.field('X position').value).toBe('');
		panel.enter('X position', '7');
		expect(panel.translationX('a')).toBe(7);
		expect(panel.translationX('b')).toBe(7);
		expect(panel.undo()).toBe(true);
		expect(panel.translationX('a')).toBe(0);
		expect(panel.translationX('b')).toBe(20);
	});

	it('coalesces Up/Down stepping into one undo step', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.press('X position', 'ArrowUp');
		panel.press('X position', 'ArrowUp');
		panel.press('X position', 'ArrowUp');
		expect(panel.translationX('a')).toBe(3);
		panel.undo();
		expect(panel.translationX('a')).toBe(0);
	});

	it('rotates about the centre and undoes in one step', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.enter('Rotation', '90');
		expect(panel.field('Rotation').value).toBe('90');
		panel.undo();
		expect(panel.field('Rotation').value).toBe('0');
	});

	it('offers alignment only where it makes sense and runs the align commands', async () => {
		const panel = await open();
		panel.select(['loose']);
		expect(panel.query('[data-alignment-row]')).toBeNull();
		panel.select(['a', 'b']);
		panel.click('button[aria-label="Align left"]');
		expect(panel.translationX('a')).toBe(panel.translationX('b'));
	});

	it('flips through the flip command', async () => {
		const panel = await open();
		panel.select(['a']);
		const before = panel.ctx.document.require('a');
		panel.click('button[aria-label="Flip horizontal"]');
		expect(panel.ctx.document.require('a')).not.toEqual(before);
	});

	it('toggles absolute position for children of auto layout frames only', async () => {
		const panel = await open();
		panel.select(['b']);
		expect(panel.query('[data-absolute-position]')).toBeNull();
		panel.setProps('f', { layoutMode: 'HORIZONTAL' });
		panel.click('button[aria-label="Absolute position"]');
		expect(panel.ctx.document.require('b')).toMatchObject({ layoutPositioning: 'ABSOLUTE' });
		panel.undo();
		expect(panel.ctx.document.require('b')).toMatchObject({ layoutPositioning: 'AUTO' });
	});
});
