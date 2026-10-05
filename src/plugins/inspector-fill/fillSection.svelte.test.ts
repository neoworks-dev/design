import { afterEach, describe, expect, it } from 'vitest';
import type { Paint } from '../../lib/document';
import { convertPaint, newPaint } from '../../lib/editing/paints';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import coreTools from '../core-tools';
import designPanel from '../design-panel';
import gradientEditor from '../gradient-editor';
import overlay from '../overlay';
import inspectorFill from './index';

const dependencies = [designPanel, colorPicker, coreTools, overlay, gradientEditor];

describePlugin('inspector-fill', inspectorFill, {
	providers: [...panelProviders(), colorPicker, coreTools, overlay, gradientEditor],
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/fill')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorFill, dependencies);
	return harness;
}

function fillsOf(panel: PanelHarness, id: string): Paint[] {
	const node = panel.ctx.document.require(id);
	if (!('fills' in node)) throw new Error(`${id} has no fills`);
	return node.fills;
}

function rows(panel: PanelHarness): number {
	return panel.ctx.document.require('a') && document.querySelectorAll('[data-paint-row]').length;
}

describe('fill section', () => {
	it('adds a fill on top, undoably', async () => {
		const panel = await open();
		panel.select(['a']);
		const before = fillsOf(panel, 'a').length;
		panel.click('button[aria-label="Add fill"]');
		expect(fillsOf(panel, 'a')).toHaveLength(before + 1);
		expect(rows(panel)).toBe(before + 1);
		panel.undo();
		expect(fillsOf(panel, 'a')).toHaveLength(before);
	});

	it('removes a fill undoably', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add fill"]');
		panel.click('button[aria-label="Remove fill 1"]');
		expect(fillsOf(panel, 'a')).toHaveLength(0);
		panel.undo();
		expect(fillsOf(panel, 'a')).toHaveLength(1);
	});

	it('types a hex and an opacity', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.setProps('a', { fills: [newPaint('fill')] });
		const hex = panel.query<HTMLInputElement>('input[aria-label="Fill 1 hex"]');
		if (!hex) throw new Error('no hex input');
		hex.value = 'ff0000';
		hex.dispatchEvent(new Event('input', { bubbles: true }));
		hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(fillsOf(panel, 'a')[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });
		panel.enter('Fill 1 opacity', '40');
		expect(fillsOf(panel, 'a')[0]).toMatchObject({ opacity: 0.4 });
	});

	it('toggles visibility', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.setProps('a', { fills: [newPaint('fill')] });
		panel.click('button[aria-label="Toggle fill 1 visibility"]');
		expect(fillsOf(panel, 'a')[0]).toMatchObject({ visible: false });
	});

	it('reorders with the grip keys: ArrowDown sends the top paint below', async () => {
		const panel = await open();
		panel.select(['a']);
		const bottom = { ...newPaint('fill'), color: { r: 1, g: 0, b: 0 } };
		const top = { ...newPaint('fill'), color: { r: 0, g: 0, b: 1 } };
		panel.setProps('a', { fills: [bottom, top] });
		const grip = panel.query('button[aria-label="Reorder fill 2"]');
		grip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(fillsOf(panel, 'a')).toEqual([top, bottom]);
		panel.undo();
		expect(fillsOf(panel, 'a')).toEqual([bottom, top]);
	});

	it('shows Mixed for different fills and keeps adding available', async () => {
		const panel = await open();
		panel.setProps('a', { fills: [newPaint('fill')] });
		panel.setProps('b', { fills: [] });
		panel.select(['a', 'b']);
		expect(panel.query('[data-paint-mixed]')).not.toBeNull();
		panel.click('button[aria-label="Add fill"]');
		expect(fillsOf(panel, 'a')).toHaveLength(2);
		expect(fillsOf(panel, 'b')).toHaveLength(1);
	});

	it('shows a bound variable as a chip with its name', async () => {
		const panel = await open();
		const collectionId = panel.ctx.variables.createCollection('Colors');
		const modeId = panel.ctx.variables.collection(collectionId)?.defaultModeId ?? '';
		const variableId = panel.ctx.variables.createVariable(collectionId, 'brand/primary', 'COLOR', {
			[modeId]: { r: 0, g: 1, b: 0, a: 1 }
		});
		panel.setProps('a', {
			fills: [
				{
					...newPaint('fill'),
					boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variableId } }
				}
			]
		});
		panel.select(['a']);
		expect(panel.query('[data-bound-chip]')?.textContent).toContain('brand/primary');
	});

	it('opens the colour picker from a solid swatch and the gradient editor from a gradient', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.setProps('a', { fills: [newPaint('fill')] });
		panel.click('button[aria-label="Edit fill 1"]');
		expect(panel.ctx.colorPicker.isOpen).toBe(true);
		panel.ctx.colorPicker.close();
		panel.setProps('a', { fills: [convertPaint(newPaint('fill'), 'GRADIENT_LINEAR')] });
		panel.click('button[aria-label="Edit fill 1"]');
		expect(panel.ctx.gradientEditor.isOpen).toBe(true);
		panel.ctx.gradientEditor.close();
	});

	it('Alt+/ command removes the top fill', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.setProps('a', { fills: [newPaint('fill'), newPaint('stroke')] });
		await panel.ctx.commands.run('fill.remove');
		expect(fillsOf(panel, 'a')).toHaveLength(1);
	});
});
