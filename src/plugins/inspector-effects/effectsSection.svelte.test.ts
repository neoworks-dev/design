import { afterEach, describe, expect, it } from 'vitest';
import type { Effect } from '../../lib/document';
import { newEffect } from '../../lib/editing/effects';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import designPanel from '../design-panel';
import inspectorEffects from './index';

describePlugin('inspector-effects', inspectorEffects, {
	providers: [...panelProviders(), colorPicker],
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/effects')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorEffects, [designPanel, colorPicker]);
	return harness;
}

function effectsOf(panel: PanelHarness, id: string): Effect[] {
	const node = panel.ctx.document.require(id);
	if (!('effects' in node)) throw new Error(`${id} has no effects`);
	return node.effects;
}

describe('effects section', () => {
	it('adds a drop shadow and undoes it', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add effect"]');
		expect(effectsOf(panel, 'a')).toEqual([newEffect('DROP_SHADOW')]);
		panel.undo();
		expect(effectsOf(panel, 'a')).toEqual([]);
	});

	it('toggles visibility and removes', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add effect"]');
		panel.click('button[aria-label="Toggle effect 1 visibility"]');
		expect(effectsOf(panel, 'a')[0].visible).toBe(false);
		panel.click('button[aria-label="Remove effect 1"]');
		expect(effectsOf(panel, 'a')).toEqual([]);
	});

	it('edits shadow values in the settings popover', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add effect"]');
		panel.click('button[aria-label="Effect 1 settings"]');
		panel.enter('Shadow X', '6');
		panel.enter('Shadow blur', '12');
		panel.enter('Shadow spread', '2');
		panel.enter('Shadow opacity', '50');
		expect(effectsOf(panel, 'a')[0]).toMatchObject({
			offset: { x: 6, y: 4 },
			radius: 12,
			spread: 2,
			color: { a: 0.5 }
		});
		panel.click('input[aria-label="Show behind node"]');
		expect(effectsOf(panel, 'a')[0]).toMatchObject({ showShadowBehindNode: true });
	});

	it('edits a blur radius', async () => {
		const panel = await open();
		panel.setProps('a', { effects: [newEffect('LAYER_BLUR')] });
		panel.select(['a']);
		panel.click('button[aria-label="Effect 1 settings"]');
		panel.enter('Blur', '9');
		expect(effectsOf(panel, 'a')[0]).toMatchObject({ type: 'LAYER_BLUR', radius: 9 });
	});

	it('reorders with the grip keys, undoably', async () => {
		const panel = await open();
		const shadow = newEffect('DROP_SHADOW');
		const blur = newEffect('LAYER_BLUR');
		panel.setProps('a', { effects: [shadow, blur] });
		panel.select(['a']);
		const grip = panel.query('button[aria-label="Reorder effect 1"]');
		grip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(effectsOf(panel, 'a')).toEqual([blur, shadow]);
		panel.undo();
		expect(effectsOf(panel, 'a')).toEqual([shadow, blur]);
	});

	it('shows Mixed when the selection has different effects', async () => {
		const panel = await open();
		panel.setProps('a', { effects: [newEffect('DROP_SHADOW')] });
		panel.select(['a', 'b']);
		expect(panel.query('[data-effects-mixed]')).not.toBeNull();
	});
});
