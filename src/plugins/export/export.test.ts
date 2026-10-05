import type { Context, Plugin } from '@neoworks/extension-system';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentChangeEvent } from '../../lib/document';
import { ExportPipelineError } from '../../lib/export/types';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../scene-fixture/fixture';
import exportRaster from '../export-raster';
import exportPlugin from './index';
import { exportTestProviders, type RecordingDesktop } from './testing';

const fakeDependencies = {
	name: 'fake-export-dependencies',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {});
		ctx.provide('document', {});
		ctx.provide('desktop', {});
	}
} as Plugin;

describePlugin('export', exportPlugin, {
	providers: [fakeDependencies],
	contributes: ({ ctx }) => {
		expect(typeof ctx.export.run).toBe('function');
		expect(ctx.export.formats.listAll()).toEqual([]);
	}
});

let providers: Plugin[];
let desktop: RecordingDesktop;
let mounted: MountedPlugin | undefined;

// Node has no OffscreenCanvas, which JPG and WEBP encoding falls back to: stand in with one that
// answers the right magic bytes, so the pipeline (sizes, names, mime types) is still exercised.
const MAGIC: Record<string, number[]> = { 'image/jpeg': [0xff, 0xd8], 'image/webp': [0x52, 0x49] };
class FakeOffscreenCanvas {
	constructor(
		readonly width: number,
		readonly height: number
	) {}
	getContext(): { putImageData(): void } {
		return { putImageData: () => undefined };
	}
	convertToBlob(options: { type: string }): Promise<Blob> {
		return Promise.resolve(new Blob([new Uint8Array(MAGIC[options.type])]));
	}
}
const originalOffscreen = Reflect.get(globalThis, 'OffscreenCanvas');

beforeAll(async () => {
	Reflect.set(globalThis, 'OffscreenCanvas', FakeOffscreenCanvas);
	Reflect.set(globalThis, 'ImageData', class {});
	({ providers, desktop } = await exportTestProviders({
		basePlugins: [coreContextKeys, coreCommands],
		document: buildFixtureDocument,
		pageId: SHAPES_PAGE_ID
	}));
});

afterAll(() => {
	Reflect.set(globalThis, 'OffscreenCanvas', originalOffscreen);
});

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	desktop.written.length = 0;
	desktop.clipboard.length = 0;
	desktop.answer = ['/tmp/out.png'];
});

async function mountExport(): Promise<Context> {
	mounted = await mountPlugin(exportPlugin, { providers });
	await mounted.ctx.plugin(exportRaster);
	return mounted.ctx;
}

const FRAME = 'frame-effects';
const SMALL = 'fx-opacity-back';

describe('export settings on nodes', () => {
	it('add, update and remove go through document.apply, one transaction each', async () => {
		const ctx = await mountExport();
		const events: DocumentChangeEvent[] = [];
		ctx.on('document/change', (event) => events.push(event));
		expect(ctx.export.settingsOf(SMALL)).toEqual([]);

		ctx.export.addSetting([SMALL]);
		ctx.export.addSetting([SMALL], {
			suffix: '@2x',
			format: 'JPG',
			constraint: { type: 'SCALE', value: 2 }
		});
		expect(ctx.export.settingsOf(SMALL).map((setting) => setting.format)).toEqual(['PNG', 'JPG']);

		ctx.export.updateSetting([SMALL], 0, { format: 'WEBP' });
		expect(ctx.export.settingsOf(SMALL)[0].format).toBe('WEBP');

		ctx.export.removeSetting([SMALL], 0);
		expect(ctx.export.settingsOf(SMALL)).toHaveLength(1);
		expect(events).toHaveLength(4);
	});

	it('a settings change is undoable data: the inverse restores the previous list', async () => {
		const ctx = await mountExport();
		const transactions: Array<{ undo: unknown }> = [];
		ctx.on('document/change', (event) => transactions.push(event.transaction));
		ctx.export.addSetting([SMALL]);
		expect(transactions).toHaveLength(1);
		expect(JSON.stringify(transactions[0].undo)).toContain('exportSettings');
	});

	it('changing the scale re-derives a suffix that followed the old scale', async () => {
		const ctx = await mountExport();
		ctx.export.addSetting([SMALL]);
		ctx.export.updateSetting([SMALL], 0, { constraint: { type: 'SCALE', value: 2 } });
		expect(ctx.export.settingsOf(SMALL)[0].suffix).toBe('@2x');
		ctx.export.updateSetting([SMALL], 0, { suffix: '-big' });
		ctx.export.updateSetting([SMALL], 0, { constraint: { type: 'SCALE', value: 3 } });
		expect(ctx.export.settingsOf(SMALL)[0].suffix).toBe('-big');
	});
});

describe('export.run', () => {
	it('several settings on one node export several files with their suffixes', async () => {
		const ctx = await mountExport();
		ctx.export.setSettings(
			[FRAME],
			[
				{ suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } },
				{ suffix: '@2x', format: 'PNG', constraint: { type: 'SCALE', value: 2 } },
				{ suffix: '-thumb', format: 'JPG', constraint: { type: 'WIDTH', value: 160 } }
			],
			'Set export settings'
		);
		const files = await ctx.export.run([FRAME]);
		const name = ctx.document.require(FRAME).name;
		expect(files.map((file) => file.name)).toEqual([
			`${name}.png`,
			`${name}@2x.png`,
			`${name}-thumb.jpg`
		]);
		expect(files.map((file) => [file.width, file.height])).toEqual([
			[640, 420],
			[1280, 840],
			[160, 105]
		]);
		expect(files[1].bytes.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
		expect(files[2].bytes.slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
	});

	it('names that collide get a counter', async () => {
		const ctx = await mountExport();
		const settings = [
			{ suffix: '', format: 'PNG' as const, constraint: { type: 'SCALE' as const, value: 1 } },
			{ suffix: '', format: 'PNG' as const, constraint: { type: 'SCALE' as const, value: 2 } }
		];
		const jobs = ctx.export.plan([SMALL], settings);
		const name = ctx.document.require(SMALL).name;
		expect(jobs.map((job) => job.fileName)).toEqual([`${name}.png`, `${name} (2).png`]);
	});

	it('a node without settings exports one 1x PNG', async () => {
		const ctx = await mountExport();
		const files = await ctx.export.run([SMALL]);
		expect(files).toHaveLength(1);
		expect(files[0].format).toBe('PNG');
	});

	it('explicit settings override the stored ones', async () => {
		const ctx = await mountExport();
		ctx.export.addSetting([SMALL]);
		const files = await ctx.export.run([SMALL], {
			settings: [{ suffix: '', format: 'WEBP', constraint: { type: 'SCALE', value: 1 } }]
		});
		expect(files.map((file) => file.format)).toEqual(['WEBP']);
	});

	it('rejects a format nobody provides, naming it', async () => {
		const ctx = await mountExport();
		await expect(
			ctx.export.run([SMALL], {
				settings: [{ suffix: '', format: 'PDF', constraint: { type: 'SCALE', value: 1 } }]
			})
		).rejects.toThrow(ExportPipelineError);
	});
});

describe('export.save and copy', () => {
	it('hands name and bytes of every file to main and returns the written paths', async () => {
		const ctx = await mountExport();
		const files = await ctx.export.run([SMALL]);
		desktop.answer = ['/tmp/a.png'];
		expect(await ctx.export.save(files)).toEqual(['/tmp/a.png']);
		expect(desktop.written[0].map((file) => file.name)).toEqual([files[0].name]);
	});

	it('a cancelled dialog resolves null', async () => {
		const ctx = await mountExport();
		desktop.answer = null;
		expect(await ctx.export.save(await ctx.export.run([SMALL]))).toBeNull();
	});

	it('copies a PNG to the clipboard and refuses other formats', async () => {
		const ctx = await mountExport();
		const [png] = await ctx.export.run([SMALL]);
		await ctx.export.copyToClipboard(png);
		expect(desktop.clipboard).toHaveLength(1);
		const [jpg] = await ctx.export.run([SMALL], {
			settings: [{ suffix: '', format: 'JPG', constraint: { type: 'SCALE', value: 1 } }]
		});
		await expect(ctx.export.copyToClipboard(jpg)).rejects.toThrow(ExportPipelineError);
	});
});
