// The `archive` service (#31): export the open document as a zip of JSON and import one back.
//
// Export reads the live document plus the image and font bytes of the open file and hands the
// archive's files (src/lib/archive/format.ts) to main, which zips them and asks where to save.
// Import has main read and unzip the chosen file, validates it with the same schema validators the
// store loader uses, asks main to create a design file from it (a new file, never the open one)
// and opens that file like any other, so a bad archive can never damage the current document.

import { Service, type Context } from '@neoworks/extension-system';
import type { ArchiveEntry, CreateFromArchiveRequest, FontRef } from '../../../electron/bridge';
import {
	ArchiveError,
	buildArchive,
	parseArchive,
	type ArchiveContents,
	type ArchiveFont
} from '../archive/format';
import type { DesignDocument } from '../document';

declare module '@neoworks/extension-system' {
	interface Context {
		archive: ArchiveService;
	}
}

/** The part of the `desktop` service this one uses. */
export interface ArchiveDesktop {
	archiveExport(suggestedName: string, entries: ArchiveEntry[]): Promise<string | null>;
	archiveRead(): Promise<{ path: string; entries: ArchiveEntry[] } | null>;
	archiveCreateFile(request: CreateFromArchiveRequest): Promise<string | null>;
	assetsGet(hash: string): Promise<Uint8Array | null>;
	assetsEmbeddedFonts(): Promise<FontRef[]>;
	assetsFontBytes(ref: FontRef): Promise<Uint8Array | null>;
}

/** The part of the `document` service this one uses. */
export interface ArchiveDocument {
	readonly snapshot: DesignDocument;
}

/** The part of the `fileSession` service this one uses. */
export interface ArchiveSession {
	readonly isAttached: boolean;
	flush(): Promise<void>;
	openDocument(path?: string): Promise<boolean>;
}

export interface ArchiveOutcome {
	kind: 'info' | 'error';
	message: string;
}

export class ArchiveService extends Service {
	constructor(
		ctx: Context,
		private readonly desktop: ArchiveDesktop,
		private readonly document: ArchiveDocument,
		private readonly session: ArchiveSession
	) {
		super(ctx, 'archive');
	}

	// ---------- export ----------

	/** The files of an archive of the open document (no dialogs); also what the tests compare. */
	async buildEntries(): Promise<ArchiveEntry[]> {
		await this.session.flush();
		const document = this.document.snapshot;
		const images = new Map<string, Uint8Array>();
		for (const record of Object.values(document.assets)) {
			const bytes = await this.desktop.assetsGet(record.id);
			if (bytes !== null) images.set(record.id, bytes);
		}
		return buildArchive(document, images, await this.embeddedFonts());
	}

	private async embeddedFonts(): Promise<ArchiveFont[]> {
		const fonts: ArchiveFont[] = [];
		for (const face of await this.desktop.assetsEmbeddedFonts()) {
			const bytes = await this.desktop.assetsFontBytes(face);
			if (bytes !== null) fonts.push({ ...face, bytes });
		}
		return fonts;
	}

	async exportArchive(): Promise<ArchiveOutcome> {
		if (!this.session.isAttached) return { kind: 'error', message: 'No document is open.' };
		try {
			const entries = await this.buildEntries();
			const path = await this.desktop.archiveExport(this.document.snapshot.name, entries);
			if (path === null) return { kind: 'info', message: 'Export cancelled.' };
			return { kind: 'info', message: `Exported the archive to ${path}.` };
		} catch (error) {
			return { kind: 'error', message: `Could not export the archive: ${messageOf(error)}` };
		}
	}

	// ---------- import ----------

	/** Validate unzipped files; throws `ArchiveError` with a readable reason. */
	parse(entries: readonly ArchiveEntry[]): ArchiveContents {
		return parseArchive(entries);
	}

	async importArchive(): Promise<ArchiveOutcome> {
		try {
			const read = await this.desktop.archiveRead();
			if (read === null) return { kind: 'info', message: 'Import cancelled.' };
			const contents = this.parse(read.entries);
			const created = await this.desktop.archiveCreateFile({
				document: contents.document,
				images: contents.images,
				fonts: contents.fonts
			});
			if (created === null) return { kind: 'info', message: 'Import cancelled.' };
			await this.session.openDocument(created);
			return { kind: 'info', message: importedMessage(contents, created) };
		} catch (error) {
			if (error instanceof ArchiveError) {
				return { kind: 'error', message: `Cannot import this archive: ${error.message}` };
			}
			return { kind: 'error', message: `Could not import the archive: ${messageOf(error)}` };
		}
	}

	snapshotState(): Record<string, unknown> {
		return {};
	}
}

function importedMessage(contents: ArchiveContents, path: string): string {
	const base = `Imported "${contents.document.name}" as ${path}.`;
	if (contents.missingImages.length === 0) return base;
	return `${base} ${contents.missingImages.length} image(s) were not in the archive.`;
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
