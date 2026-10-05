import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { parseParams } from '../../lib/plugins/api/schemas';
import type { PluginConnection } from '../../lib/plugins/connection';
import { PluginToastsService } from '../../lib/services/pluginToasts';
import PluginToasts from './PluginToasts.svelte';

/** A page with more nodes than this is too large for the worker's copy. */
const MAX_SNAPSHOT_NODES = 50_000;

const notifySchema = z.strictObject({
	message: z.string().max(2000),
	error: z.boolean().optional(),
	timeout: z.number().positive().optional()
});

interface OpenRun {
	release(): void;
	done: Promise<unknown>;
}

// Third-party plugins, part eight (#159): the host side of the Figma compatibility layer. The
// worker library (lib/plugins/worker/figma) builds the `figma` global; this plugin answers what it
// needs: `figma.snapshot` (the current page and selection), `figma.beginRun` / `figma.endRun` (the
// plugin's launch is one undo step) and `figma.notify` (a toast). Everything else the layer does
// goes through the ordinary plugin API (`document.apply`, `selection.set`, `storage.*`).
export default {
	name: 'plugin-figma-compat',
	inject: ['pluginHost', 'document', 'selection', 'viewport', 'regions'],
	apply(ctx: Context): void {
		const toasts = new PluginToastsService(ctx);
		const openRuns = new WeakMap<PluginConnection, OpenRun>();

		ctx.effect(
			() =>
				ctx.pluginHost.registerApi('figma', {
					snapshot: {
						permission: 'document:read',
						run: () => {
							const currentPageId = ctx.document.currentPageId;
							const nodes = ctx.document.query(() => true, currentPageId);
							if (nodes.length > MAX_SNAPSHOT_NODES) {
								throw new Error(
									`the page has ${nodes.length} layers; the Figma layer handles up to ${MAX_SNAPSHOT_NODES}`
								);
							}
							return {
								currentPageId,
								pages: ctx.document.pages(),
								selection: [...ctx.selection.ids],
								nodes,
								zoom: ctx.viewport.zoom,
								documentName: ctx.document.documentName
							};
						}
					},
					beginRun: async (call) => {
						const connection = call.connection;
						if (openRuns.has(connection)) return;
						let release = (): void => {};
						const ended = new Promise<void>((resolve) => {
							release = resolve;
						});
						// An unloaded plugin must not leave its run (and its timeout) behind.
						call.context.effect(() => () => release(), 'figma layer run');
						const started = new Promise<void>((resolve) => {
							const done = connection.runScoped(connection.manifest.name, 'command', () => {
								resolve();
								return ended;
							});
							done.catch(() => {});
							openRuns.set(connection, { release, done });
						});
						await started;
					},
					endRun: async (call) => {
						const run = openRuns.get(call.connection);
						if (run === undefined) return;
						openRuns.delete(call.connection);
						run.release();
						await run.done;
					},
					notify: (call, params) => {
						const request = parseParams(notifySchema, params);
						toasts.show(call.pluginId, request.message, request.error === true, request.timeout);
					}
				}),
			'plugin api figma'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-figma-compat/toasts',
					region: 'overlay',
					component: PluginToasts
				}),
			'plugin toasts'
		);
	}
};
