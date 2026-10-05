// Test fixtures for the text plugins (not shipped): the provider set text editing needs, with the
// real text layout on a headless CanvasKit and the bundled Geist faces registered, and a helper
// that mounts a plugin with one text node in the document.

import type { Context, Plugin } from '@neoworks/extension-system';
import type { CanvasKit } from 'canvaskit-wasm';
import { createNode } from '../../../lib/document/defaults';
import type { Paragraph, TextNode } from '../../../lib/document/types';
import { editingProviders } from '../../../lib/editing/fixtures/editingFixture';
import type { FontEntry, FontRef } from '../../../lib/fonts/resolve';
import { mountPlugin, type MountedPlugin } from '../../../lib/kernel/testing';
import { loadCanvasKit } from '../../../lib/renderer/canvaskit';
import { nodeWasmLocator } from '../../../lib/renderer/canvaskit.node';
import { DrawHookRegistry, type DrawHooks } from '../../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../../lib/renderer/ownership';
import { loadTestFaces, testResolver } from '../../../lib/text/testing';
import textLayout from '../../text-layout';
import variablesCore from '../../variables-core';

type FontSink = { registerFont(face: FontEntry, bytes: ArrayBuffer): void };

export function loadTestKit(): Promise<CanvasKit> {
	return loadCanvasKit(nodeWasmLocator());
}

function fakes(kit: CanvasKit, sinks: FontSink[]): Plugin {
	return {
		name: 'fake-renderer-fonts-viewport',
		inject: [],
		apply(ctx: Context): void {
			const registry = new DrawHookRegistry();
			ctx.provide('renderer', {
				registerDrawHooks: (hooks: Partial<DrawHooks>) => registry.register(hooks)
			});
			ctx.provide('canvaskit', { kit, tracker: new SkiaTracker() });
			ctx.provide('viewport', {
				zoom: 1,
				worldToScreen: (point: { x: number; y: number }) => point,
				screenToWorld: (point: { x: number; y: number }) => point
			});
			ctx.provide('fonts', {
				resolve: testResolver,
				load: (_ref: FontRef) => Promise.resolve(),
				attach: (sink: FontSink) => {
					sinks.push(sink);
					return () => Promise.resolve();
				}
			});
		}
	} as Plugin;
}

export function textEditProviders(kit: CanvasKit, sinks: FontSink[]): Plugin[] {
	return [fakes(kit, sinks), ...editingProviders(), variablesCore, textLayout];
}

/** Mounts `plugin` (and everything below) with a text node `t` on the page. */
export async function mountWithText(
	plugin: Plugin,
	kit: CanvasKit,
	paragraphs: Paragraph[],
	props: Partial<TextNode> = {},
	extraProviders: Plugin[] = []
): Promise<MountedPlugin> {
	const sinks: FontSink[] = [];
	const providers = [...textEditProviders(kit, sinks), ...extraProviders];
	const mounted = await mountPlugin(plugin, { providers });
	for (const sink of sinks) {
		for (const { face, bytes } of await loadTestFaces()) sink.registerFont(face, bytes);
	}
	const { ctx } = mounted;
	const base = createNode('TEXT', { id: 't', parentId: 'p', index: 'a0', ...props });
	const node: TextNode = {
		...base,
		...props,
		paragraphs,
		defaultStyle: { ...base.defaultStyle, fontName: { family: 'Geist', style: 'Regular' } }
	};
	ctx.document.apply(ctx.document.insertNode(node), { origin: 'user', label: 'Add text' });
	return mounted;
}
