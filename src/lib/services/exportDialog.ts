// The `exportDialog` service (#129): the export dialog's logic over `export`.
//
// The dialog starts from what the nodes store and lets the user override the file type and the
// size for this export only: nothing is written to the document, so cancelling leaves no trace.
// It plans the files (same names as the files that get written), previews one at a time and hands
// the result to `export.save`, which asks main where to put it.

import { Service, type Context } from '@neoworks/extension-system';
import type { ExportSetting, NodeId } from '../document';
import { defaultExportSetting, parseConstraint, suffixForConstraint } from '../export/settings';
import { objectUrlFor } from '../export/objectUrl';
import type { ExportFile, ExportFormatName, ExportJob } from '../export/types';
import type { ExportDialogState, ExportScope, PreviewState } from './exportDialogState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		exportDialog: ExportDialogService;
	}
}

/** Largest preview image shown, in bytes of PNG/JPG/WEBP/SVG. Bigger files are not previewed. */
const PREVIEWABLE: ExportFormatName[] = ['PNG', 'JPG', 'WEBP', 'SVG'];

export class ExportDialogService extends Service {
	private previewToken = 0;

	constructor(
		ctx: Context,
		private readonly state: ExportDialogState
	) {
		super(ctx, 'exportDialog');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.isOpen;
	}
	get scope(): ExportScope {
		return this.state.scope;
	}
	get format(): ExportFormatName | null {
		return this.state.format;
	}
	get sizeText(): string | null {
		return this.state.sizeText;
	}
	get busy(): boolean {
		return this.state.busy;
	}
	get status(): ExportDialogState['status'] {
		return this.state.status;
	}
	get preview(): PreviewState | null {
		return this.state.preview;
	}
	get previewIndex(): number {
		return this.state.previewIndex;
	}

	/** The nodes the chosen scope exports. */
	nodeIds(): NodeId[] {
		const { document } = this.ctx;
		if (this.state.scope === 'selection') {
			return this.ctx.selection.ids.filter((id) => document.has(id));
		}
		const pageId = document.currentPageId;
		const nodes = document.query((node) => node.type !== 'PAGE', pageId);
		if (this.state.scope === 'slices') {
			return nodes.filter((node) => node.type === 'SLICE').map((node) => node.id);
		}
		return nodes.filter((node) => this.hasSettings(node.id)).map((node) => node.id);
	}

	private hasSettings(id: NodeId): boolean {
		return this.ctx.export.settingsOf(id).length > 0;
	}

	/** The override setting, or `undefined` to export with each node's stored settings. */
	overrideSettings(): ExportSetting[] | undefined {
		const { format, sizeText } = this.state;
		if (format === null && sizeText === null) return undefined;
		const base = defaultExportSetting();
		const constraint = this.parsedSize();
		const setting: ExportSetting = {
			suffix: suffixForConstraint(constraint),
			format: format === null ? base.format : format,
			constraint
		};
		return [setting];
	}

	private parsedSize(): ExportSetting['constraint'] {
		const fallback = defaultExportSetting().constraint;
		if (this.state.sizeText === null) return fallback;
		const parsed = parseConstraint(this.state.sizeText);
		if (parsed === null) return fallback;
		return parsed;
	}

	/** Whether the typed size is understood (an empty override is fine). */
	get sizeIsValid(): boolean {
		if (this.state.sizeText === null) return true;
		return parseConstraint(this.state.sizeText) !== null;
	}

	/** The files an export with the dialog's choices would write; empty when nothing applies. */
	jobs(): ExportJob[] {
		const ids = this.nodeIds();
		if (ids.length === 0) return [];
		try {
			return this.ctx.export.plan(ids, this.overrideSettings());
		} catch {
			return [];
		}
	}

	// ---------- opening and choices ----------

	open(scope?: ExportScope): void {
		const { state } = this;
		state.scope = scope === undefined ? this.defaultScope() : scope;
		state.format = null;
		state.sizeText = null;
		state.previewIndex = 0;
		state.status = null;
		state.isOpen = true;
		void this.refreshPreview();
	}

	/** Selection when something is selected, else everything marked for export. */
	private defaultScope(): ExportScope {
		if (this.ctx.selection.ids.length > 0) return 'selection';
		return 'all';
	}

	close(): void {
		this.previewToken += 1;
		this.releasePreview();
		const { state } = this;
		state.isOpen = false;
		state.busy = false;
		state.status = null;
	}

	toggle(): void {
		if (this.state.isOpen) this.close();
		else this.open();
	}

	setScope(scope: ExportScope): void {
		this.state.scope = scope;
		this.state.previewIndex = 0;
		void this.refreshPreview();
	}

	setFormat(format: ExportFormatName | null): void {
		this.state.format = format;
		void this.refreshPreview();
	}

	setSizeText(text: string | null): void {
		this.state.sizeText = text;
		void this.refreshPreview();
	}

	showPreview(index: number): void {
		const count = this.jobs().length;
		if (count === 0) return;
		this.state.previewIndex = Math.min(Math.max(index, 0), count - 1);
		void this.refreshPreview();
	}

	// ---------- preview ----------

	/** Renders the file at `previewIndex` and shows it; stale answers are dropped. */
	async refreshPreview(): Promise<void> {
		this.previewToken += 1;
		const token = this.previewToken;
		const jobs = this.jobs();
		const index = Math.min(this.state.previewIndex, Math.max(jobs.length - 1, 0));
		this.releasePreview();
		if (jobs.length === 0 || !this.sizeIsValid) return;
		const job = jobs[index];
		this.state.previewIndex = index;
		if (!PREVIEWABLE.includes(job.setting.format)) {
			this.state.preview = this.blankPreview(index, 'unavailable', 'No preview for this format');
			return;
		}
		this.state.preview = this.blankPreview(index, 'loading', '');
		try {
			const file = await this.ctx.export.renderJob(job);
			if (token !== this.previewToken) return;
			this.state.preview = this.readyPreview(index, file);
		} catch (error) {
			if (token !== this.previewToken) return;
			this.state.preview = this.blankPreview(index, 'failed', messageOf(error));
		}
	}

	private blankPreview(
		index: number,
		status: PreviewState['status'],
		message: string
	): PreviewState {
		return { index, status, url: null, width: 0, height: 0, bytes: 0, message };
	}

	private readyPreview(index: number, file: ExportFile): PreviewState {
		const url = objectUrlFor(file.bytes, file.mimeType);
		return {
			index,
			status: 'ready',
			url,
			width: file.width,
			height: file.height,
			bytes: file.bytes.byteLength,
			message: ''
		};
	}

	private releasePreview(): void {
		const { preview } = this.state;
		if (preview !== null && preview.url !== null) URL.revokeObjectURL(preview.url);
		this.state.preview = null;
	}

	// ---------- doing it ----------

	/** Renders and writes every planned file. Resolves with the written paths; null if cancelled. */
	async exportAssets(): Promise<string[] | null> {
		const { state } = this;
		const ids = this.nodeIds();
		if (ids.length === 0 || !this.sizeIsValid || state.busy) return null;
		state.busy = true;
		state.status = null;
		try {
			const files = await this.ctx.export.run(ids, { settings: this.overrideSettings() });
			const paths = await this.ctx.export.save(files);
			if (paths === null) {
				state.status = { kind: 'info', text: 'Export cancelled, nothing was written.' };
				return null;
			}
			state.status = { kind: 'info', text: `Exported ${paths.length} file(s).` };
			return paths;
		} catch (error) {
			state.status = { kind: 'error', text: messageOf(error) };
			return null;
		} finally {
			state.busy = false;
		}
	}

	/** Puts the previewed file on the clipboard as PNG. */
	async copyToClipboard(): Promise<void> {
		const { state } = this;
		const jobs = this.jobs();
		if (jobs.length === 0 || state.busy) return;
		state.busy = true;
		try {
			const job = jobs[Math.min(state.previewIndex, jobs.length - 1)];
			const png = { ...job.setting, format: 'PNG' as const };
			const file = await this.ctx.export.renderJob({ ...job, setting: png });
			await this.ctx.export.copyToClipboard(file);
			state.status = { kind: 'info', text: 'Copied to the clipboard as PNG.' };
		} catch (error) {
			state.status = { kind: 'error', text: messageOf(error) };
		} finally {
			state.busy = false;
		}
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.isOpen };
	}
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
