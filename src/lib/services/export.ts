// The `export` service (#125): orchestrates exports of nodes.
//
//   const files = await ctx.export.run(selectionIds);                 // each node's own settings
//   const files = await ctx.export.run(ids, { settings: [{ ... }] }); // or explicit settings
//   await ctx.export.save(files);                                     // native save, written by main
//
// Settings are node data (`exportSettings`) and change through `document.apply`, so they undo
// like any edit. Formats are contributed by plugins through `formats.register` (export-raster,
// export-svg, export-pdf); this service resolves the area, the scale and the file names and hands
// each job to the provider of its format. Everything is read through the variable resolver: the
// providers draw from the renderer's resolved scene (data-model section 4).

import { Service, type Context } from '@neoworks/extension-system';
import type { Change, ExportSetting, NodeId } from '../document';
import {
	defaultExportSetting,
	fileNameFor,
	scaleFor,
	suffixForConstraint,
	uniqueFileNames
} from '../export/settings';
import {
	ExportPipelineError,
	type ExportFile,
	type ExportFormatProvider,
	type ExportJob,
	type ExportRunOptions
} from '../export/types';
import { Registry } from '../registries/registry.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		export: ExportService;
	}
}

export interface ExportOptions extends ExportRunOptions {
	/** Settings to export with instead of each node's stored ones. */
	settings?: ExportSetting[];
}

export class ExportService extends Service {
	/** Format providers by format name; contributed by the format plugins. */
	readonly formats = new Registry<ExportFormatProvider>();

	constructor(ctx: Context) {
		super(ctx, 'export');
	}

	// ---------- settings on nodes (undoable document data) ----------

	/** The stored export settings of a node (empty when it has none). */
	settingsOf(id: NodeId): ExportSetting[] {
		const node = this.ctx.document.require(id);
		if (!('exportSettings' in node)) return [];
		if (node.exportSettings === undefined) return [];
		return node.exportSettings;
	}

	setSettings(ids: readonly NodeId[], settings: ExportSetting[], label: string): void {
		const changes: Change[] = [];
		for (const id of ids)
			changes.push(...this.ctx.document.setProps(id, { exportSettings: settings }));
		this.applyChanges(changes, label);
	}

	/** Appends a setting to every node. */
	addSetting(ids: readonly NodeId[], setting: ExportSetting = defaultExportSetting()): void {
		const changes: Change[] = [];
		for (const id of ids) {
			const next = [...this.settingsOf(id), setting];
			changes.push(...this.ctx.document.setProps(id, { exportSettings: next }));
		}
		this.applyChanges(changes, 'Add export setting');
	}

	updateSetting(ids: readonly NodeId[], index: number, patch: Partial<ExportSetting>): void {
		const changes: Change[] = [];
		for (const id of ids) {
			const current = this.settingsOf(id);
			if (index >= current.length) continue;
			const next = current.map((entry, position) => {
				if (position !== index) return entry;
				return this.patched(entry, patch);
			});
			changes.push(...this.ctx.document.setProps(id, { exportSettings: next }));
		}
		this.applyChanges(changes, 'Change export setting');
	}

	removeSetting(ids: readonly NodeId[], index: number): void {
		const changes: Change[] = [];
		for (const id of ids) {
			const next = this.settingsOf(id).filter((_, position) => position !== index);
			changes.push(...this.ctx.document.setProps(id, { exportSettings: next }));
		}
		this.applyChanges(changes, 'Remove export setting');
	}

	/** A patch that changes the scale re-derives the `@2x` suffix when the old one followed it. */
	private patched(entry: ExportSetting, patch: Partial<ExportSetting>): ExportSetting {
		const next = { ...entry, ...patch };
		if (patch.constraint === undefined || patch.suffix !== undefined) return next;
		if (entry.suffix !== suffixForConstraint(entry.constraint)) return next;
		return { ...next, suffix: suffixForConstraint(patch.constraint) };
	}

	private applyChanges(changes: Change[], label: string): void {
		if (changes.length === 0) return;
		this.ctx.document.apply(changes, { origin: 'user', label, mergeKey: undefined });
	}

	// ---------- running ----------

	/** The files an export would write, named and de-duplicated, without rendering anything. */
	plan(ids: readonly NodeId[], settings?: ExportSetting[]): ExportJob[] {
		const jobs: Omit<ExportJob, 'fileName'>[] = [];
		const names: string[] = [];
		for (const nodeId of ids) {
			const node = this.ctx.document.require(nodeId);
			for (const setting of this.settingsFor(nodeId, settings)) {
				jobs.push({ nodeId, setting });
				names.push(fileNameFor(node.name, setting, this.provider(setting).extension));
			}
		}
		const unique = uniqueFileNames(names);
		return jobs.map((job, index) => ({ ...job, fileName: unique[index] }));
	}

	/** Renders every job. Rejects with the first failure, naming the file. */
	async run(ids: readonly NodeId[], options: ExportOptions = {}): Promise<ExportFile[]> {
		const files: ExportFile[] = [];
		for (const job of this.plan(ids, options.settings)) {
			files.push(await this.renderJob(job, options));
		}
		return files;
	}

	async renderJob(job: ExportJob, options: ExportRunOptions = {}): Promise<ExportFile> {
		const provider = this.provider(job.setting);
		const area = this.ctx.headlessRenderer.exportArea(
			job.nodeId,
			options.useAbsoluteBounds === true
		);
		const scale = scaleFor(job.setting, area);
		try {
			const rendered = await provider.render({ nodeId: job.nodeId, scale, area, options });
			return {
				nodeId: job.nodeId,
				setting: job.setting,
				name: job.fileName,
				format: provider.id,
				mimeType: provider.mimeType,
				...rendered
			};
		} catch (error) {
			if (error instanceof Error) {
				throw new ExportPipelineError(`could not export ${job.fileName}: ${error.message}`);
			}
			throw error;
		}
	}

	/** Hands the files to main: one file asks where to save it, several ask for a folder. */
	save(files: readonly ExportFile[]): Promise<string[] | null> {
		return this.ctx.desktop.writeExports(
			files.map((file) => ({ name: file.name, bytes: file.bytes }))
		);
	}

	/** Puts one PNG on the OS clipboard (the only image kind the clipboard carries). */
	async copyToClipboard(file: ExportFile): Promise<void> {
		if (file.format !== 'PNG') {
			throw new ExportPipelineError('only PNG files can be copied to the clipboard');
		}
		await this.ctx.desktop.clipboardWrite({ png: file.bytes });
	}

	// ---------- internals ----------

	private provider(setting: ExportSetting): ExportFormatProvider {
		const provider = this.formats.get(setting.format);
		if (provider === undefined) {
			throw new ExportPipelineError(`no plugin exports ${setting.format}`);
		}
		return provider;
	}

	/** Explicit settings, else the node's own, else one default PNG so a plain export works. */
	private settingsFor(id: NodeId, explicit: ExportSetting[] | undefined): ExportSetting[] {
		if (explicit !== undefined && explicit.length > 0) return explicit;
		const stored = this.settingsOf(id);
		if (stored.length > 0) return stored;
		return [defaultExportSetting()];
	}
}
