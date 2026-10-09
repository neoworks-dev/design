import type { Context } from '@neoworks/extension-system';
import { currentEnvironment, isFixtureEnabled } from './enabled';
import { buildFixtureDocument, FIXTURE_FILE_ID, SHAPES_PAGE_ID } from './fixture';
import { attachFixtureImages } from './images';

export interface SceneFixtureConfig {
	/** Overrides detection (tests). By default: dev server or a `?qa=1` QA session. */
	enabled?: boolean;
	/** Page shown after loading; the shapes page by default, the newest feature page. */
	startPage?: string;
}

function isEnabled(config: SceneFixtureConfig | undefined): boolean {
	if (config && config.enabled !== undefined) return config.enabled;
	return isFixtureEnabled(currentEnvironment());
}

function startPageOf(config: SceneFixtureConfig | undefined): string {
	if (config && config.startPage !== undefined) return config.startPage;
	return SHAPES_PAGE_ID;
}

function loadFixture(ctx: Context, config: SceneFixtureConfig | undefined): void {
	ctx.document.replaceDocument(buildFixtureDocument());
	ctx.document.setCurrentPage(startPageOf(config));
}

// Dev and QA only: loads a hand-built document into the document service, so QA scenes go through
// the real path (document -> document-scene adapter -> renderer). Unloading puts the previous
// document back. A production build opened normally never loads it.
//
// When `blobs` exists and a file is open, the fixture's pictures are stored in it and the image
// paints point at them; otherwise they keep a pending hash and draw as placeholders.
//
// Nothing opens a file at launch (the home screen shows), so the fixture is only ever replaced by
// the user opening or creating a real file. That replacement wins: reloading the fixture over it
// would put fixture nodes into the open file, and autosave would send changes main cannot apply.
export default {
	name: 'scene-fixture',
	inject: ['document'],
	apply(ctx: Context, config?: SceneFixtureConfig): void {
		if (!isEnabled(config)) return;
		ctx.inject(['blobs'], (withBlobs) => {
			const attach = (): void => {
				if (withBlobs.document.documentId !== FIXTURE_FILE_ID) return;
				// with no file open the store refuses and the paints stay placeholders
				attachFixtureImages(withBlobs).catch((error: unknown) => withBlobs.logger.warn(error));
			};
			withBlobs.on('document/replace', attach);
			attach();
		});
		ctx.effect(() => {
			const previous = ctx.document.snapshot;
			const previousPageId = ctx.document.currentPageId;
			loadFixture(ctx, config);
			return () => {
				ctx.document.replaceDocument(previous);
				ctx.document.setCurrentPage(previousPageId);
			};
		}, 'scene-fixture/document');
	}
};
