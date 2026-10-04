import type { Context } from '@neoworks/extension-system';
import { currentEnvironment, isFixtureEnabled } from './enabled';
import { buildFixtureDocument, SHAPES_PAGE_ID } from './fixture';

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
// The file session starts a blank document asynchronously after boot, which would replace the
// fixture. The first replacement that is not ours therefore loads the fixture again, once.
export default {
	name: 'scene-fixture',
	inject: ['document'],
	apply(ctx: Context, config?: SceneFixtureConfig): void {
		if (!isEnabled(config)) return;
		let loading = false;
		let reloaded = false;
		ctx.on('document/replace', () => {
			if (loading || reloaded) return;
			reloaded = true;
			loading = true;
			loadFixture(ctx, config);
			loading = false;
		});
		ctx.effect(() => {
			const previous = ctx.document.snapshot;
			const previousPageId = ctx.document.currentPageId;
			loading = true;
			loadFixture(ctx, config);
			loading = false;
			return () => {
				loading = true;
				ctx.document.replaceDocument(previous);
				ctx.document.setCurrentPage(previousPageId);
				loading = false;
			};
		}, 'scene-fixture/document');
	}
};
