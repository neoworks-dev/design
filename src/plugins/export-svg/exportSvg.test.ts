import { mkdirSync, writeFileSync } from 'node:fs';
import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { importSvg } from '../../lib/svg/importSvg';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { ExportService } from '../../lib/services/export';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import exportPlugin from '../export';
import exportRaster from '../export-raster';
import { exportTestProviders } from '../export/testing';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../scene-fixture/fixture';
import exportSvg from './index';

const fakeDependencies = {
	name: 'fake-svg-dependencies',
	inject: [],
	apply(ctx: Context): void {
		new ExportService(ctx);
		ctx.provide('headlessRenderer', {});
		ctx.provide('document', {});
	}
} as Plugin;

describePlugin('export-svg', exportSvg, {
	providers: [fakeDependencies],
	contributes: ({ ctx }) => {
		expect(ctx.export.formats.get('SVG')?.extension).toBe('svg');
	}
});

let providers: Plugin[];
let mounted: MountedPlugin | undefined;

beforeAll(async () => {
	({ providers } = await exportTestProviders({
		basePlugins: [coreContextKeys, coreCommands],
		document: buildFixtureDocument,
		pageId: SHAPES_PAGE_ID
	}));
});

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountSvg(): Promise<Context> {
	mounted = await mountPlugin(exportPlugin, { providers });
	await mounted.ctx.plugin(exportRaster);
	await mounted.ctx.plugin(exportSvg);
	return mounted.ctx;
}

const SVG_SETTING = [
	{ suffix: '', format: 'SVG' as const, constraint: { type: 'SCALE' as const, value: 1 } }
];

async function svgOf(ctx: Context, id: string): Promise<string> {
	const [file] = await ctx.export.run([id], { settings: SVG_SETTING });
	expect(file.mimeType).toBe('image/svg+xml');
	return new TextDecoder().decode(file.bytes);
}

describe('SVG export of the scene fixture', () => {
	it('every top-level frame serialises to well-formed XML that the SVG importer reads back', async () => {
		const ctx = await mountSvg();
		const frames = ctx.document.children(SHAPES_PAGE_ID);
		expect(frames.length).toBeGreaterThan(3);
		for (const id of frames) {
			const svg = await svgOf(ctx, id);
			const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
			expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
			expect(importSvg(svg), `frame ${id}`).not.toBeNull();
			if (process.env.EXPORT_DUMP !== undefined) {
				mkdirSync(process.env.EXPORT_DUMP, { recursive: true });
				writeFileSync(`${process.env.EXPORT_DUMP}/${id}.svg`, svg);
				const [png] = await ctx.export.run([id]);
				writeFileSync(`${process.env.EXPORT_DUMP}/${id}.png`, png.bytes);
			}
		}
	});

	it('size and viewBox follow the node bounds and the scale', async () => {
		const ctx = await mountSvg();
		const svg = await svgOf(ctx, 'frame-effects');
		expect(svg).toContain('width="640" height="420"');
		const [file] = await ctx.export.run(['frame-effects'], {
			settings: [{ suffix: '', format: 'SVG', constraint: { type: 'SCALE', value: 2 } }]
		});
		expect(new TextDecoder().decode(file.bytes)).toContain('width="1280" height="840"');
	});

	it('writes gradients, strokes, clip paths and shadow filters where the fixture has them', async () => {
		const ctx = await mountSvg();
		let all = '';
		for (const id of ctx.document.children(SHAPES_PAGE_ID)) all += await svgOf(ctx, id);
		expect(all).toContain('<linearGradient');
		expect(all).toContain('<radialGradient');
		expect(all).toContain('stroke-width=');
		expect(all).toContain('<clipPath');
		expect(all).toContain('<filter');
		expect(all).toContain('<mask');
	});

	it('puts the node id on its element unless asked not to', async () => {
		const ctx = await mountSvg();
		const svg = await svgOf(ctx, 'fx-opacity-back');
		expect(svg).toContain('id="fx-opacity-back"');
	});
});
