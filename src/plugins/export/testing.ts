// Test harness of the export plugins: a real document service, a real headless renderer over the
// scene fixture and a recording `desktop`, so export tests run the whole pipeline in Node.

import type { Context, Plugin } from '@neoworks/extension-system';
import type { DesignDocument } from '../../lib/document';
import type { ExportFileData } from '../../../electron/bridge';
import { SceneIndex } from '../../lib/document';
import { loadCanvasKit } from '../../lib/renderer/canvaskit';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import { EFFECT_DRAW_HOOKS } from '../../lib/renderer/draw/effects';
import { DrawHookRegistry } from '../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../lib/renderer/ownership';
import { StoreSceneSource } from '../../lib/renderer/storeSceneSource';
import { DocumentService } from '../../lib/services/document';
import { DocumentState } from '../../lib/services/documentState.svelte';
import { HeadlessRendererService } from '../../lib/services/headlessRenderer';

export interface RecordingDesktop {
	written: ExportFileData[][];
	clipboard: Array<{ png?: Uint8Array }>;
	/** What `writeExports` answers; `null` simulates a cancelled dialog. */
	answer: string[] | null;
}

/** What the test file imports for us: plugins may not be imported from non-test sources. */
export interface ExportTestFixtures {
	basePlugins: Plugin[];
	document: () => DesignDocument;
	pageId: string;
}

export async function exportTestProviders(fixtures: ExportTestFixtures): Promise<{
	providers: Plugin[];
	desktop: RecordingDesktop;
}> {
	const canvasKit = await loadCanvasKit(nodeWasmLocator());
	const desktop: RecordingDesktop = { written: [], clipboard: [], answer: ['/tmp/out.png'] };
	const fakeHeadless = {
		name: 'fake-headless',
		inject: [],
		apply(ctx: Context): void {
			const hooks = new DrawHookRegistry();
			hooks.register(EFFECT_DRAW_HOOKS);
			const source = new StoreSceneSource(fixtures.document(), { pageId: fixtures.pageId });
			new HeadlessRendererService(ctx, () => ({
				canvasKit,
				tracker: new SkiaTracker(),
				hooks,
				source,
				geometry: new SceneIndex(source.store)
			}));
		}
	} as Plugin;
	const fixtureDocument = {
		name: 'fixture-document',
		inject: ['commands'],
		apply(ctx: Context): void {
			const state = new DocumentState();
			state.replace(fixtures.document());
			new DocumentService(ctx, state);
		}
	} as Plugin;
	const fakeDesktop = {
		name: 'fake-desktop',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('desktop', {
				writeExports: (files: ExportFileData[]) => {
					desktop.written.push(files);
					return Promise.resolve(desktop.answer);
				},
				clipboardWrite: (content: { png?: Uint8Array }) => {
					desktop.clipboard.push(content);
					return Promise.resolve();
				}
			});
		}
	} as Plugin;
	return {
		providers: [...fixtures.basePlugins, fixtureDocument, fakeHeadless, fakeDesktop],
		desktop
	};
}
