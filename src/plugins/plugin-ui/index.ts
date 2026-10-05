import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { parseParams } from '../../lib/plugins/api/schemas';
import { appliesToSelection } from '../../lib/plugins/stubs';
import type { SurfacePatch } from '../../lib/plugins/surface';
import PluginModalHost from '../../lib/plugins/ui/PluginModalHost.svelte';
import { SurfaceStore } from '../../lib/plugins/ui/surfaceStore.svelte';
import SurfaceView from '../../lib/plugins/ui/SurfaceView.svelte';
import { PluginUiService } from '../../lib/services/pluginUi';
import type { ApiNamespace } from '../../lib/services/pluginHost';

/** Runtime-registered inspector sections come after the built-in ones. */
const PLUGIN_SECTION_ORDER = 100;

const surface = z.string().min(1).max(200);

const schemas = {
	set: z.strictObject({ surface, tree: z.unknown() }),
	patch: z.strictObject({
		surface,
		version: z.number().int().positive(),
		ops: z
			.array(
				z.discriminatedUnion('op', [
					z.strictObject({
						op: z.literal('replace'),
						path: z.array(z.number().int()),
						node: z.unknown()
					}),
					z.strictObject({
						op: z.literal('props'),
						path: z.array(z.number().int()),
						set: z.record(z.string(), z.unknown()),
						unset: z.array(z.string())
					}),
					z.strictObject({
						op: z.literal('insert'),
						path: z.array(z.number().int()),
						index: z.number().int().min(0),
						node: z.unknown()
					}),
					z.strictObject({
						op: z.literal('remove'),
						path: z.array(z.number().int()),
						index: z.number().int().min(0)
					})
				])
			)
			.max(5000)
	}),
	surfaceOnly: z.strictObject({ surface }),
	resize: z.strictObject({
		surface,
		width: z.number().min(120).max(4000),
		height: z.number().min(40).max(4000)
	}),
	modal: z.strictObject({
		surface,
		title: z.string().min(1).max(200),
		width: z.number().min(120).max(4000).optional(),
		height: z.number().min(40).max(4000).optional()
	}),
	inspector: z.strictObject({
		id: z.string().min(1).max(200),
		title: z.string().min(1).max(200),
		tab: z.string().min(1).max(100).optional(),
		nodeTypes: z.array(z.string().min(1)).min(1).optional()
	})
};

// Third-party plugins, part five (#157): provides `pluginUi`, the declarative UI of plugins. A
// worker describes surfaces as JSON trees (`design.ui.set`) and the host renders them with the
// design system into the panels and inspector sections its manifest declares, or into a modal it
// opens. Input comes back as events naming a handler the plugin attached. Trees are validated
// (unknown node types fail closed), updates are patches, and a surface disappears with its worker.
export default {
	name: 'plugin-ui',
	inject: ['pluginHost', 'pluginRegistry', 'panels', 'regions', 'inspectors'],
	apply(ctx: Context): void {
		const host = ctx.pluginHost;
		const ui = new PluginUiService(ctx, new SurfaceStore(), host, ctx.pluginRegistry, ctx.panels);
		const book = host.registrations;

		const methods: ApiNamespace = {
			set: {
				permission: 'ui:panel',
				run: (call, params) => {
					const request = parseParams(schemas.set, params);
					ui.set(call.connection, request.surface, request.tree);
				}
			},
			patch: {
				permission: 'ui:panel',
				run: (call, params) => {
					const request = parseParams(schemas.patch, params);
					ui.patch(
						call.connection,
						request.surface,
						request.version,
						request.ops as SurfacePatch[]
					);
				}
			},
			show: {
				permission: 'ui:panel',
				run: (call, params) =>
					ui.show(call.connection, parseParams(schemas.surfaceOnly, params).surface)
			},
			hide: {
				permission: 'ui:panel',
				run: (call, params) =>
					ui.hide(call.connection, parseParams(schemas.surfaceOnly, params).surface)
			},
			resize: {
				permission: 'ui:panel',
				run: (call, params) => {
					const request = parseParams(schemas.resize, params);
					ui.resize(call.connection, request.surface, request.width, request.height);
				}
			},
			showModal: {
				permission: 'ui:panel',
				run: (call, params) => {
					const request = parseParams(schemas.modal, params);
					ui.showModal(
						call.connection,
						request.surface,
						request.title,
						request.width,
						request.height
					);
				}
			},
			registerInspector: {
				permission: 'ui:panel',
				run: (call, params) => {
					const request = parseParams(schemas.inspector, params);
					if (!request.id.startsWith(`${call.pluginId}.`)) {
						throw new Error(
							`"${request.id}" must start with "${call.pluginId}." (the plugin's id)`
						);
					}
					const dispose = call.context.effect(
						() =>
							ctx.inspectors.register({
								id: request.id,
								tab: request.tab === undefined ? 'design' : request.tab,
								title: request.title,
								order: PLUGIN_SECTION_ORDER,
								applies: (selection) => appliesToSelection(request.nodeTypes, selection),
								component: SurfaceView,
								props: { pluginId: call.pluginId, surfaceId: request.id }
							}),
						`plugin ${call.pluginId} inspector ${request.id}`
					);
					return book.add(call.connection, dispose);
				}
			}
		};
		ctx.effect(() => host.registerApi('ui', methods), 'plugin api ui');

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-ui/modals',
					region: 'overlay',
					component: PluginModalHost
				}),
			'plugin modal host'
		);
	}
};
