import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { createNode, type TextNode } from '../../lib/document';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import type { FontRef } from '../../lib/fonts/resolve';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import textFormat from '../text-format';
import inspectorTypography from './index';
import { filterFamilies, styleForFamily, stylesOfFamily } from './typography';

const FACES: FontRef[] = [
	{ family: 'Geist', style: 'Regular' },
	{ family: 'Geist', style: 'Bold' },
	{ family: 'Mono', style: 'Regular' }
];

const fakeFonts = {
	name: 'fake-fonts',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('fonts', {
			faces: () => FACES,
			families: () => ['Geist', 'Mono'],
			isMissing: (ref: FontRef) => ref.family === 'Missing'
		})
} as Plugin;

const fakeTextEdit = {
	name: 'fake-text-edit',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('textEdit', { active: false, state: { typingStyle: null } })
} as Plugin;

const providers = (): Plugin[] => [...panelProviders(), fakeFonts, fakeTextEdit, textFormat];

describePlugin('inspector-typography', inspectorTypography, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/typography')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function openWithText(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectorTypography, [
		designPanel,
		fakeFonts,
		fakeTextEdit,
		textFormat
	]);
	const base = createNode('TEXT', { id: 't', parentId: 'f', index: 'z0' });
	harness.ctx.document.apply(harness.ctx.document.insertNode(base), {
		origin: 'user',
		label: 'Add text'
	});
	harness.select(['t']);
	return harness;
}

function textNode(panel: PanelHarness): TextNode {
	const node = panel.ctx.document.require('t');
	if (node.type !== 'TEXT') throw new Error('not text');
	return node;
}

describe('typography section', () => {
	it('only shows for a selection that contains text', async () => {
		const panel = await openWithText();
		expect(panel.sectionIds()).toContain('design/typography');
		panel.select(['a']);
		expect(panel.sectionIds()).not.toContain('design/typography');
	});

	it('sets the font size on the whole node and undoes it', async () => {
		const panel = await openWithText();
		panel.enter('Font size', '32');
		expect(textNode(panel).defaultStyle.fontSize).toBe(32);
		panel.undo();
		expect(textNode(panel).defaultStyle.fontSize).toBe(16);
	});

	it('shows Mixed for diverging sizes across nodes', async () => {
		const panel = await openWithText();
		const second = createNode('TEXT', { id: 't2', parentId: 'f', index: 'z1' });
		panel.ctx.document.apply(panel.ctx.document.insertNode(second), {
			origin: 'user',
			label: 'Add text'
		});
		panel.enter('Font size', '40');
		panel.select(['t', 't2']);
		expect(panel.field('Font size').placeholder).toBe('Mixed');
	});

	it('changes alignment through the text format service', async () => {
		const panel = await openWithText();
		panel.click('button[aria-label="Align center"]');
		expect(textNode(panel).paragraphs[0].align).toBe('CENTER');
	});

	it('sets node level settings through the document path', async () => {
		const panel = await openWithText();
		panel.click('button[aria-label="Fixed size"]');
		expect(textNode(panel).textAutoResize).toBe('NONE');
		panel.click('button[aria-label="Align middle"]');
		expect(textNode(panel).textAlignVertical).toBe('CENTER');
		panel.undo();
		expect(textNode(panel).textAlignVertical).toBe('TOP');
	});

	it('toggles decoration and sets automatic line height', async () => {
		const panel = await openWithText();
		panel.click('button[aria-label="Type settings"]');
		panel.click('button[aria-label="Underline"]');
		expect(textNode(panel).defaultStyle.textDecoration).toBe('UNDERLINE');
		panel.click('button[aria-label="Underline"]');
		expect(textNode(panel).defaultStyle.textDecoration).toBe('NONE');
		panel.enter('Line height', '150');
		expect(textNode(panel).defaultStyle.lineHeight).toEqual({ value: 150, unit: 'PERCENT' });
	});

	it('picks a family, keeping the nearest style, and flags a missing font', async () => {
		const panel = await openWithText();
		panel.click('[data-font-family-picker] button[aria-label="Font family"]');
		const option = [...document.querySelectorAll('[role="option"] button')].find(
			(button) => button.textContent.trim() === 'Mono'
		);
		(option as HTMLElement).click();
		expect(textNode(panel).defaultStyle.fontName).toEqual({ family: 'Mono', style: 'Regular' });
		panel.setProps('t', {
			defaultStyle: {
				...textNode(panel).defaultStyle,
				fontName: { family: 'Missing', style: 'Regular' }
			}
		});
		expect(panel.query('[data-missing-font]')).not.toBeNull();
	});
});

describe('typography helpers', () => {
	it('finds the nearest style of a family', () => {
		expect(styleForFamily(['Regular', 'Bold'], 'SemiBold')).toBe('Bold');
		expect(styleForFamily(['Regular', 'Bold'], 'Regular')).toBe('Regular');
	});

	it('lists the styles of a family in weight order and filters families', () => {
		expect(stylesOfFamily(FACES, 'geist')).toEqual(['Regular', 'Bold']);
		expect(filterFamilies(['Geist', 'Mono'], 'mo')).toEqual(['Mono']);
	});
});
