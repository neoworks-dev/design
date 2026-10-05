import { mkdirSync, writeFileSync } from 'node:fs';
import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { arcToCubics, serializePdf } from '../../lib/export/pdf';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { ExportService } from '../../lib/services/export';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import exportPlugin from '../export';
import { exportTestProviders } from '../export/testing';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../scene-fixture/fixture';
import exportPdf from './index';

const fakeDependencies = {
	name: 'fake-pdf-dependencies',
	inject: [],
	apply(ctx: Context): void {
		new ExportService(ctx);
		ctx.provide('headlessRenderer', {});
		ctx.provide('document', {});
	}
} as Plugin;

describePlugin('export-pdf', exportPdf, {
	providers: [fakeDependencies],
	contributes: ({ ctx }) => {
		expect(ctx.export.formats.get('PDF')?.mimeType).toBe('application/pdf');
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

async function mountPdf(): Promise<Context> {
	mounted = await mountPlugin(exportPlugin, { providers });
	await mounted.ctx.plugin(exportPdf);
	return mounted.ctx;
}

const PDF_SETTING = [
	{ suffix: '', format: 'PDF' as const, constraint: { type: 'SCALE' as const, value: 1 } }
];

function text(bytes: Uint8Array): string {
	return new TextDecoder('latin1').decode(bytes);
}

describe('PDF export', () => {
	it('writes a structurally valid PDF whose xref offsets point at their objects', async () => {
		const ctx = await mountPdf();
		const [file] = await ctx.export.run(['frame-shapes'], { settings: PDF_SETTING });
		const pdf = text(file.bytes);
		expect(pdf.startsWith('%PDF-1.4')).toBe(true);
		expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
		const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
		expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
		const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)];
		expect(entries.length).toBeGreaterThan(5);
		entries.forEach((entry, index) => {
			expect(pdf.slice(Number(entry[1])).startsWith(`${index + 1} 0 obj`)).toBe(true);
		});
		expect(pdf).toContain('/MediaBox [0 0 640 420]');
	});

	it('keeps the artwork as vector operators: paths, fills, curves', async () => {
		const ctx = await mountPdf();
		const [file] = await ctx.export.run(['frame-shapes'], { settings: PDF_SETTING });
		const pdf = text(file.bytes);
		expect(pdf).toMatch(/ c\n/);
		expect(pdf).toMatch(/\nf\n/);
		expect(pdf).not.toContain('/Subtype /Image');
	});

	it('scales the page, and writes one page per root', async () => {
		const ctx = await mountPdf();
		const [file] = await ctx.export.run(['frame-strokes'], {
			settings: [{ suffix: '', format: 'PDF', constraint: { type: 'SCALE', value: 2 } }]
		});
		expect(text(file.bytes)).toContain('/MediaBox [0 0 1280 840]');
		const { source, geometry } = ctx.headlessRenderer.scene();
		const area = ctx.headlessRenderer.exportArea('frame-shapes');
		const result = serializePdf(
			source,
			geometry,
			[
				{ nodeId: 'frame-shapes', area },
				{ nodeId: 'frame-strokes', area }
			],
			1
		);
		expect(result.pageCount).toBe(2);
		expect(text(result.bytes)).toContain('/Count 2');
	});

	it('dumps the fixture frames for viewing when EXPORT_DUMP is set', async () => {
		if (process.env.EXPORT_DUMP === undefined) return;
		const ctx = await mountPdf();
		mkdirSync(process.env.EXPORT_DUMP, { recursive: true });
		for (const id of ctx.document.children(SHAPES_PAGE_ID)) {
			const [file] = await ctx.export.run([id], { settings: PDF_SETTING });
			writeFileSync(`${process.env.EXPORT_DUMP}/${id}.pdf`, file.bytes);
		}
	});
});

describe('arcToCubics', () => {
	it('a clockwise quarter arc ends where it should and stays on the circle', () => {
		const [cubic] = arcToCubics(10, 0, {
			op: 'arc',
			radiusX: 10,
			radiusY: 10,
			clockwise: true,
			x: 20,
			y: 10
		});
		expect(cubic.op).toBe('cubic');
		if (cubic.op !== 'cubic') return;
		expect([cubic.x, cubic.y]).toEqual([expect.closeTo(20, 6), expect.closeTo(10, 6)]);
		// the circle is centred on (10, 10): the control points lie outside the chord, on its side
		expect(cubic.x1).toBeGreaterThan(10);
		expect(cubic.y2).toBeLessThan(10);
	});

	it('a counter-clockwise quarter arc takes the other centre', () => {
		const [cubic] = arcToCubics(10, 0, {
			op: 'arc',
			radiusX: 10,
			radiusY: 10,
			clockwise: false,
			x: 0,
			y: 10
		});
		if (cubic.op !== 'cubic') throw new Error('expected a cubic');
		expect([cubic.x, cubic.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(10, 6)]);
		expect(cubic.x1).toBeLessThan(10);
	});
});
