import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeId } from '../../lib/document';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { SceneChange, SceneSource } from '../../lib/renderer/sceneSource';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import documentPlugin from '../document';
import selection from '../selection';
import sceneFixture from '../scene-fixture';
import {
	FIRST_PAGE_ID,
	FIXTURE_COLLECTION_ID,
	FIXTURE_MODE_DARK,
	SECOND_PAGE_ID
} from '../scene-fixture/fixture';
import variablesCore from '../variables-core';
import documentScene from './index';

interface Recorded {
	sources: SceneSource[];
	selectionProviders: (() => readonly NodeId[])[];
}

function fakeRendererAndViewport(recorded: Recorded): Plugin {
	return {
		name: 'fake-renderer-and-viewport',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('renderer', {
				setSceneSource(source: SceneSource): () => void {
					recorded.sources.push(source);
					return () => {
						recorded.sources.splice(recorded.sources.indexOf(source), 1);
					};
				}
			});
			ctx.provide('viewport', {
				setSelectionProvider(provider: () => readonly NodeId[]): () => void {
					recorded.selectionProviders.push(provider);
					return () => {
						recorded.selectionProviders.splice(recorded.selectionProviders.indexOf(provider), 1);
					};
				}
			});
		}
	} as Plugin;
}

function providersFor(recorded: Recorded): Plugin[] {
	return [
		coreContextKeys,
		coreCommands,
		documentPlugin,
		variablesCore,
		selection,
		fakeRendererAndViewport(recorded),
		{
			...sceneFixture,
			apply: (ctx: Context) => sceneFixture.apply(ctx, { enabled: true, startPage: FIRST_PAGE_ID })
		} as Plugin
	];
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountScene(): Promise<{ mounted: MountedPlugin; recorded: Recorded }> {
	const recorded: Recorded = { sources: [], selectionProviders: [] };
	mounted = await mountPlugin(documentScene, { providers: providersFor(recorded) });
	return { mounted, recorded };
}

function onlySource(recorded: Recorded): SceneSource {
	expect(recorded.sources).toHaveLength(1);
	return recorded.sources[0];
}

const user = { origin: 'user' as const, label: 'Test' };

describe('document-scene', () => {
	it('shows the current page of the document and its nodes to the renderer', async () => {
		const { mounted: scene, recorded } = await mountScene();
		const source = onlySource(recorded);
		expect(source.currentPageId()).toBe(FIRST_PAGE_ID);
		expect(source.children(FIRST_PAGE_ID)).toEqual(scene.ctx.document.children(FIRST_PAGE_ID));
		expect(source.getNode('rect-red')?.type).toBe('RECTANGLE');
		scene.ctx.document.setCurrentPage(SECOND_PAGE_ID);
		expect(source.currentPageId()).toBe(SECOND_PAGE_ID);
	});

	it('tells subscribers about changes (granular) and about page switches and replaced documents (reset)', async () => {
		const { mounted: scene, recorded } = await mountScene();
		const source = onlySource(recorded);
		const seen: SceneChange['kind'][] = [];
		source.subscribe((change) => seen.push(change.kind));
		const { document } = scene.ctx;
		document.apply(document.setProps('rect-red', { name: 'Renamed' }), user);
		document.setCurrentPage(SECOND_PAGE_ID);
		document.replaceDocument(document.snapshot);
		// replacing the document resets for the new document and for its first page (the fixture
		// also reloads itself once when the document is replaced behind its back)
		expect(seen[0]).toBe('changes');
		expect(seen.slice(1).length).toBeGreaterThanOrEqual(3);
		expect(seen.slice(1).every((kind) => kind === 'reset')).toBe(true);
	});

	it('resolves bound variables per mode and never exposes the raw stored color', async () => {
		const { mounted: scene, recorded } = await mountScene();
		const source = onlySource(recorded);
		const { document } = scene.ctx;
		scene.ctx.document.setCurrentPage('page-shapes');
		const fill = (): unknown => {
			const stored = document.get('fills-variable');
			if (!stored) throw new Error('missing node');
			const resolved = source.resolve(stored);
			return 'fills' in resolved && resolved.fills[0].type === 'SOLID' && resolved.fills[0].color;
		};
		expect(fill()).toMatchObject({ r: 0.13, g: 0.46, b: 0.96 });
		const stored = document.get('fills-variable');
		expect(stored && 'fills' in stored && stored.fills[0]).toMatchObject({
			color: { r: 0.5, g: 0.5, b: 0.5 }
		});
		document.apply(
			document.setProps('frame-fills', {
				explicitVariableModes: { [FIXTURE_COLLECTION_ID]: FIXTURE_MODE_DARK }
			}),
			user
		);
		expect(fill()).toMatchObject({ r: 0.98, g: 0.4, b: 0.2 });
	});

	it('gives the viewport the selection and stops serving the document when unloaded', async () => {
		const { mounted: scene, recorded } = await mountScene();
		expect(recorded.selectionProviders).toHaveLength(1);
		scene.ctx.selection.select(['frame-b']);
		expect(recorded.selectionProviders[0]()).toEqual(['frame-b']);
		await scene.fiber.dispose();
		expect(recorded.sources).toHaveLength(0);
		expect(recorded.selectionProviders).toHaveLength(0);
	});
});

const recordedForStandardTest: Recorded = { sources: [], selectionProviders: [] };

describePlugin('document-scene', documentScene, {
	providers: providersFor(recordedForStandardTest),
	contributes: () => {
		expect(recordedForStandardTest.sources).toHaveLength(1);
		expect(recordedForStandardTest.selectionProviders).toHaveLength(1);
	}
});
