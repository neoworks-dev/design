import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import {
	createApiNamespaces,
	DeletionGuard,
	type ApiServices,
	type PluginApiBlocklist
} from '../../lib/plugins/api/handlers';
import { PluginUndo } from '../../lib/plugins/api/undo';

const pluginApiConfigSchema = z
	.object({
		blockedCommandPrefixes: z
			.array(z.string())
			.default(['app.', 'file.', 'ai.', 'ai-', 'home.', 'tabs.', 'edit.undo', 'edit.redo'])
			.describe('Commands whose id starts with one of these cannot be run by plugins.')
	})
	.prefault({});
type PluginApiConfig = z.infer<typeof pluginApiConfigSchema>;

// Third-party plugins, part four (#156): plugin API v1 (native). Registers the namespaces a plugin's
// worker can call on `pluginHost`: `document` (read, apply, protect), `selection`, `viewport`,
// `commands`, `menus`, `tools`, `aiTools`, `codegen`, `history`. Forwards `selectionchange`,
// `currentpagechange`, `documentchange` and `viewportchange` to the plugins that subscribed, and
// makes every plugin run (command, UI event) one undo step through a history group.
//
// Writes go through `document.apply` as `origin: 'plugin'`. Registrations live on the plugin's
// worker fiber and are removed when it stops; the plugin's document changes are user data and stay.
// To add an API namespace (the Figma subset, storage) register it with `pluginHost.registerApi`.
export default {
	name: 'plugin-api',
	inject: [
		'pluginHost',
		'document',
		'selection',
		'viewport',
		'history',
		'commands',
		'menus',
		'tools',
		'ai',
		'codegen'
	],
	Config: pluginApiConfigSchema,
	apply(ctx: Context, config: PluginApiConfig): void {
		const host = ctx.pluginHost;
		const undo = new PluginUndo(ctx.history);
		const guard = new DeletionGuard();
		const blocklist: PluginApiBlocklist = {
			isBlockedCommand: (id) =>
				config.blockedCommandPrefixes.some((prefix) => id.startsWith(prefix))
		};
		const services: ApiServices = {
			document: ctx.document,
			selection: ctx.selection,
			viewport: ctx.viewport,
			commands: ctx.commands,
			menus: ctx.menus,
			tools: ctx.tools,
			ai: ctx.ai,
			codegen: ctx.codegen,
			host,
			undo,
			blocklist
		};

		for (const [name, namespace] of Object.entries(createApiNamespaces(services, guard))) {
			ctx.effect(() => host.registerApi(name, namespace), `plugin api ${name}`);
		}
		ctx.effect(() => host.registerRunScope(undo.scope), 'plugin api undo per run');
		ctx.effect(
			() =>
				host.registerEventPermissions({
					selectionchange: 'selection',
					currentpagechange: 'document:read',
					documentchange: 'document:read',
					viewportchange: 'document:read'
				}),
			'plugin api event permissions'
		);

		ctx.on('selection/change', (ids, previousIds) =>
			host.broadcast('selectionchange', { ids: [...ids], previousIds: [...previousIds] })
		);
		ctx.on('document/currentpagechange', (pageId, previousPageId) =>
			host.broadcast('currentpagechange', { pageId, previousPageId })
		);
		ctx.on('document/change', (event) =>
			host.broadcast('documentchange', {
				revision: event.revision,
				origin: event.meta.origin,
				label: event.meta.label,
				changes: event.changes
			})
		);
		ctx.on('viewport/change', (camera) =>
			host.broadcast('viewportchange', { x: camera.x, y: camera.y, zoom: camera.scale })
		);
		// Layers a plugin protects cannot be deleted by anyone (the `before-delete` interception).
		ctx.on('document/before-apply', (_changes, _meta, next) => {
			const result = next();
			guard.check(result);
			return result;
		});
	}
};
