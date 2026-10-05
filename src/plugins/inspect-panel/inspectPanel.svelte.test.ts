import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { boxModelOf } from '../../lib/codegen/boxModel';
import { pixelsToRem } from '../../lib/codegen/providers';
import type { InstanceNode, Paint } from '../../lib/document';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import { compareWithMain } from './compare';
import inspectPanel from './index';
import { isReadyForDev } from './readyForDev';

interface Measure {
	selectionIds: readonly string[];
	targetId: string;
}

const measured: (Measure | null)[] = [];

const fakeSnapping = {
	name: 'snapping',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('snapping', {
			measure: (request: Measure) => void measured.push(request),
			clearMeasurement: () => void measured.push(null)
		})
} as Plugin;

describePlugin('inspect-panel', inspectPanel, {
	providers: [...panelProviders(), fakeSnapping],
	contributes: ({ ctx }) => {
		expect(ctx.codegen.providers().map((provider) => provider.id)).toEqual(['css', 'svg', 'json']);
		expect(ctx.panels.getTab('inspect')?.side).toBe('right');
		expect(ctx.panels.sectionRegistry.get('file/ready-for-dev')).toBeDefined();
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
	measured.length = 0;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(inspectPanel, [designPanel, fakeSnapping]);
	harness.ctx.panels.setMode('dev');
	await Promise.resolve();
	flushSync();
	harness.ctx.panels.activateTab('inspect');
	flushSync();
	return harness;
}

const RED: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 1, g: 0, b: 0 }
};

function code(panel: PanelHarness, language: string, id: string): string {
	return panel.ctx.codegen
		.generate(language, id)
		.map((block) => block.code)
		.join('\n---\n');
}

describe('codegen', () => {
	it('produces CSS for a styled rectangle', async () => {
		const panel = await open();
		panel.setProps('a', { fills: [RED], cornerRadius: 4, opacity: 0.5, width: 32, height: 16 });
		expect(code(panel, 'css', 'a')).toBe(
			[
				'width: 32px;',
				'height: 16px;',
				'background: #ff0000;',
				'border-radius: 4px;',
				'opacity: 0.5;'
			].join('\n')
		);
	});

	it('converts pixels to rem', async () => {
		const panel = await open();
		panel.setProps('a', { width: 32, height: 16 });
		const blocks = panel.ctx.codegen.generate('css', 'a', { unit: 'rem', rootFontSize: 16 });
		expect(blocks[0].code).toContain('width: 2rem;');
		expect(blocks[0].code).toContain('height: 1rem;');
		expect(pixelsToRem('margin: 0 8px;', 8)).toBe('margin: 0 1rem;');
	});

	it('produces SVG and JSON, and unknown languages produce nothing', async () => {
		const panel = await open();
		expect(code(panel, 'svg', 'a')).toContain('<svg');
		expect(JSON.parse(code(panel, 'json', 'a'))).toMatchObject({ id: 'a', type: 'RECTANGLE' });
		expect(panel.ctx.codegen.generate('cobol', 'a')).toEqual([]);
	});

	it('shows resolved values and the bound variable name', async () => {
		const panel = await open();
		const { variables } = panel.ctx;
		const collection = variables.createCollection('Brand');
		const [mode] = variables.collection(collection)?.modes ?? [];
		const variable = variables.createVariable(collection, 'brand', 'COLOR', {
			[mode.modeId]: { r: 0, g: 0, b: 1, a: 1 }
		});
		panel.setProps('a', { fills: [RED] });
		variables.bindPaintColor('a', 'fills', 0, variable);
		const blocks = panel.ctx.codegen.generate('css', 'a');
		expect(blocks[0].code).toContain('#0000ff');
		expect(blocks[1]).toEqual({ title: 'Variables', code: 'fill 1 color: brand' });
	});

	it('lets plugins add a language', async () => {
		const panel = await open();
		const dispose = panel.ctx.codegen.register({
			id: 'plain',
			label: 'Plain',
			generate: (input) => [{ title: input.node.name, code: input.node.type }]
		});
		expect(code(panel, 'plain', 'a')).toBe('RECTANGLE');
		dispose();
		expect(panel.ctx.codegen.provider('plain')).toBeUndefined();
	});
});

describe('inspect panel', () => {
	it('lists the properties of the selected layer and copies as code', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.query('[data-property-list]')?.textContent).toContain('width');
		expect(panel.query('[data-box-model]')?.textContent).toContain('10 x 10');
		panel.ctx.codegen.settings.view = 'code';
		flushSync();
		expect(panel.query('[data-code]')?.textContent).toContain('width: 10px;');
	});

	it('asks to select a single layer', async () => {
		const panel = await open();
		expect(panel.query('[data-inspect-panel]')?.textContent).toContain('Select a layer');
		panel.select(['a', 'b']);
		expect(panel.query('[data-inspect-panel]')?.textContent).toContain('single layer');
	});

	it('marks a top-level frame as ready for dev, persists it and undoes it', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.query('[data-ready-for-dev]')).toBeNull();
		panel.select(['f']);
		panel.click('[data-ready-for-dev]');
		expect(isReadyForDev(panel.ctx.document.require('f'))).toBe(true);
		expect(panel.ctx.document.require('f').pluginData).toEqual({
			'inspect-panel': { readyForDev: 'true' }
		});
		panel.undo();
		expect(isReadyForDev(panel.ctx.document.require('f'))).toBe(false);
	});

	it('measures to the hovered layer in dev mode without Alt', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.ctx.selection.setHover('b');
		flushSync();
		await Promise.resolve();
		expect(measured.at(-1)).toEqual({ selectionIds: ['a'], targetId: 'b' });
		panel.ctx.panels.setMode('design');
		flushSync();
		await Promise.resolve();
		expect(measured.at(-1)).toBeNull();
	});
});

describe('box model and comparison', () => {
	it('reads size, border and padding', async () => {
		const panel = await open();
		panel.setProps('f', { layoutMode: 'HORIZONTAL', paddingTop: 4, paddingLeft: 8 });
		const box = boxModelOf(panel.ctx.document.require('f'));
		expect(box).toMatchObject({ width: 400, height: 400, padding: { top: 4, left: 8 } });
	});

	it('lists the properties an instance changed from its main component', async () => {
		const panel = await open();
		const main = panel.ctx.document.require('a');
		const instance = { ...main, type: 'INSTANCE', opacity: 0.4 } as unknown as InstanceNode;
		const differences = compareWithMain(instance, main);
		expect(differences).toEqual([{ property: 'opacity', main: 1, instance: 0.4 }]);
	});
});
