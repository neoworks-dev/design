// Test fixtures for the assets panel and the resources search: a document with three main
// components, a viewport with a visible rectangle, and a hit test whose answer the test sets.

import type { Context, Plugin } from '@neoworks/extension-system';
import type { DesignDocument, NodeId } from '../../../lib/document';
import { buildDocument, frame, node, page, rectangle } from '../../../lib/document/fixtures';
import { at, box, editingProviders } from '../../../lib/editing/fixtures/editingFixture';
import { panelProviders } from '../../../lib/editing/fixtures/panelHarness';
import commandPalette from '../../command-palette';
import componentSync from '../../component-sync';

export function assetsDocument(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'f', name: 'Host', transform: at(0, 0), width: 400, height: 400 }, [
					box('a', 0, 0),
					box('b', 20, 20)
				]),
				node(
					'COMPONENT',
					{
						id: 'm-primary',
						name: 'Button/Primary',
						transform: at(500, 0),
						width: 100,
						height: 40
					},
					[rectangle({ id: 'm-primary-bg', name: 'bg', width: 100, height: 40 })]
				),
				node(
					'COMPONENT',
					{ id: 'm-icon', name: 'Icon', transform: at(500, 100), width: 24, height: 24 },
					[rectangle({ id: 'm-icon-glyph', name: 'glyph', width: 24, height: 24 })]
				),
				node(
					'COMPONENT',
					{ id: 'm-host', name: 'Card', transform: at(500, 200), width: 200, height: 200 },
					[rectangle({ id: 'm-host-inner', name: 'inner', width: 10, height: 10 })]
				)
			],
			{ id: 'p' }
		)
	]);
}

/** What `hitTest.deepest` answers; tests set it before dropping something on the canvas. */
export const hit: { id: NodeId | undefined } = { id: undefined };

const fakeViewport = {
	name: 'viewport',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('viewport', {
			zoom: 1,
			screenToWorld: (point: { x: number; y: number }) => point,
			visibleRect: () => ({ x: 1000, y: 1000, width: 200, height: 100 }),
			zoomToSelection: (): boolean => true
		})
} as Plugin;

const fakeHitTest = {
	name: 'hit-test',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('hitTest', { deepest: () => hit.id })
} as Plugin;

/** The panel providers with this file's document, plus what the assets plugins need. */
export function assetsProviders(
	options: { palette?: boolean; document?: DesignDocument } = {}
): Plugin[] {
	// The panel providers load the standard sample document; swap in this one.
	const base = panelProviders().filter(
		(plugin) => plugin.name !== 'viewport' && plugin.name !== 'document'
	);
	const documentPlugin = editingProviders(options.document ?? assetsDocument()).find(
		(plugin) => plugin.name === 'document'
	);
	if (documentPlugin === undefined) throw new Error('no document provider');
	const providers = [...base, documentPlugin, componentSync, fakeViewport, fakeHitTest];
	if (options.palette === true) providers.push(commandPalette);
	return providers;
}
