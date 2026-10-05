import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import exportPlugin from '../export';
import exportRaster from '../export-raster';
import exportUi from './index';

const written: Array<Array<{ name: string; bytes: Uint8Array }>> = [];
let saveAnswer: string[] | null = ['/tmp/x.png'];

// What the real headless renderer would answer: every node is 10x10, the "image" is a PNG header.
const fakeBackends = {
	name: 'fake-export-backends',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportArea: () => ({ x: 0, y: 0, width: 10, height: 10 }),
			exportNode: (_id: string, options: { scale?: number }) => {
				const scale = options.scale === undefined ? 1 : options.scale;
				return Promise.resolve({
					bytes: new Uint8Array([137, 80, 78, 71]),
					width: Math.ceil(10 * scale),
					height: Math.ceil(10 * scale)
				});
			}
		});
		ctx.provide('desktop', {
			writeExports: (files: Array<{ name: string; bytes: Uint8Array }>) => {
				written.push(files);
				return Promise.resolve(saveAnswer);
			},
			clipboardWrite: () => Promise.resolve()
		});
	}
} as Plugin;

const providers = [...panelProviders(), fakeBackends, exportPlugin, exportRaster];

describePlugin('export-ui', exportUi, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('design/export')).toBeDefined();
		expect(ctx.commands.has('export.dialog')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+shift+e');
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'export-ui/dialog'
		);
	}
});

let harness: PanelHarness | undefined;
let overlay: { target: HTMLElement; host: ReturnType<typeof mount> } | undefined;

afterEach(async () => {
	if (overlay) {
		await unmount(overlay.host);
		overlay.target.remove();
		overlay = undefined;
	}
	await harness?.dispose();
	harness = undefined;
	written.length = 0;
	saveAnswer = ['/tmp/x.png'];
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(exportUi, [
		designPanel,
		fakeBackends,
		exportPlugin,
		exportRaster
	]);
	return harness;
}

function mountOverlay(panel: PanelHarness): void {
	const target = document.createElement('div');
	document.body.append(target);
	overlay = {
		target,
		host: mount(HostRoot, { target, props: { ctx: panel.ctx, region: 'overlay' } })
	};
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('export section', () => {
	it('adds, edits and removes settings through the document, and undoes them', async () => {
		const panel = await open();
		panel.select(['a']);
		expect(panel.sectionIds()).toContain('design/export');
		panel.click('button[aria-label="Add export setting"]');
		expect(panel.ctx.export.settingsOf('a')).toHaveLength(1);

		const size = panel.field('Export size');
		size.value = '2x';
		size.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(panel.ctx.export.settingsOf('a')[0]).toMatchObject({
			suffix: '@2x',
			constraint: { type: 'SCALE', value: 2 }
		});

		panel.click('button[aria-label="Add export setting"]');
		expect(panel.ctx.export.settingsOf('a')).toHaveLength(2);
		panel.click('[data-export-setting="1"] button[aria-label="Remove export setting"]');
		expect(panel.ctx.export.settingsOf('a')).toHaveLength(1);

		panel.undo();
		expect(panel.ctx.export.settingsOf('a')).toHaveLength(2);
		panel.undo();
		panel.undo();
		panel.undo();
		expect(panel.ctx.export.settingsOf('a')).toHaveLength(0);
	});

	it('an invalid size is refused and the field shows the stored value again', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.click('button[aria-label="Add export setting"]');
		const size = panel.field('Export size');
		size.value = '99x';
		size.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(size.value).toBe('1x');
		expect(panel.ctx.export.settingsOf('a')[0].constraint.value).toBe(1);
	});

	it('the export button writes the files of the node settings through main', async () => {
		const panel = await open();
		panel.select(['a']);
		panel.ctx.export.setSettings(
			['a'],
			[
				{ suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } },
				{ suffix: '@2x', format: 'PNG', constraint: { type: 'SCALE', value: 2 } }
			],
			'setup'
		);
		flushSync();
		expect(panel.query('[data-export-run]')?.textContent).toContain('Export a');
		panel.click('[data-export-run] button');
		await settle();
		expect(written).toHaveLength(1);
		expect(written[0].map((file) => file.name)).toEqual(['a.png', 'a@2x.png']);
	});
});

describe('export dialog', () => {
	it('opens with Mod+Shift+E semantics, lists the files and previews the first', async () => {
		const panel = await open();
		panel.select(['a', 'b']);
		mountOverlay(panel);
		await panel.ctx.commands.run('export.dialog');
		await settle();
		expect(overlay?.target.querySelector('[data-export-dialog]')).not.toBeNull();
		expect(overlay?.target.querySelector('[data-export-count]')?.textContent).toContain('2 file');
		expect(overlay?.target.querySelector('[data-export-file-name]')?.textContent).toBe('a.png');
		expect(overlay?.target.querySelector('[data-export-dialog-preview]')).not.toBeNull();
		panel.ctx.exportDialog.showPreview(1);
		await settle();
		expect(overlay?.target.querySelector('[data-export-file-name]')?.textContent).toBe('b.png');
	});

	it('exports with the dialog choices, which match the planned files', async () => {
		const panel = await open();
		panel.select(['a']);
		const dialog = panel.ctx.exportDialog;
		dialog.open();
		dialog.setSizeText('3x');
		dialog.setFormat('JPG');
		expect(dialog.jobs().map((job) => job.fileName)).toEqual(['a@3x.jpg']);
		const paths = await dialog.exportAssets();
		expect(paths).toEqual(['/tmp/x.png']);
		expect(written[0].map((file) => file.name)).toEqual(['a@3x.jpg']);
		dialog.close();
	});

	it('cancel leaves nothing: no document change, no file, no stored setting', async () => {
		const panel = await open();
		panel.select(['a']);
		const before = panel.ctx.document.revision;
		const dialog = panel.ctx.exportDialog;
		dialog.open();
		dialog.setSizeText('2x');
		dialog.setFormat('WEBP');
		dialog.close();
		expect(dialog.isOpen).toBe(false);
		expect(panel.ctx.document.revision).toBe(before);
		expect(panel.ctx.export.settingsOf('a')).toEqual([]);
		expect(written).toHaveLength(0);
	});

	it('a cancelled save dialog writes nothing and keeps the dialog open', async () => {
		const panel = await open();
		panel.select(['a']);
		saveAnswer = null;
		const dialog = panel.ctx.exportDialog;
		dialog.open();
		expect(await dialog.exportAssets()).toBeNull();
		expect(dialog.isOpen).toBe(true);
		expect(dialog.status?.text).toContain('cancelled');
		dialog.close();
	});

	it('with nothing to export it says so and disables Export asset', async () => {
		const panel = await open();
		panel.select([]);
		mountOverlay(panel);
		panel.ctx.exportDialog.open('slices');
		await settle();
		expect(overlay?.target.querySelector('[data-export-empty]')).not.toBeNull();
		const button = [...(overlay?.target.querySelectorAll('button') ?? [])].find(
			(entry) => entry.textContent?.trim() === 'Export asset'
		);
		expect(button?.disabled).toBe(true);
		panel.ctx.exportDialog.close();
	});
});
