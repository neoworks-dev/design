import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { parseParams } from '../../lib/plugins/api/schemas';
import { PluginPermissionsService } from '../../lib/services/pluginPermissions';
import PermissionPromptHost from './PermissionPromptHost.svelte';

const fetchSchema = z.strictObject({
	url: z.string().min(1).max(4096),
	method: z.string().min(1).max(10).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.string().max(5_000_000).optional()
});

// Third-party plugins, part six (#158): provides `pluginPermissions`, which answers the host's
// `plugins/permission` event. A manifest only declares permissions; the first call that needs one
// asks the user (once per plugin, all declared permissions together) and the answer is stored by
// main per plugin and project, revocable in the plugin manager. A refused call fails with a
// `PermissionDeniedError`. Also offers `network.fetch`, which main answers only for the hosts of the
// manifest's allowlist (and the worker's Content-Security-Policy keeps everything else out).
export default {
	name: 'plugin-permissions',
	inject: ['pluginHost', 'pluginRegistry', 'desktop', 'regions'],
	apply(ctx: Context): void {
		const permissions = new PluginPermissionsService(ctx, ctx.pluginRegistry, {
			load: () => ctx.desktop.pluginsPermissions(),
			save: (pluginId, permission, granted) =>
				ctx.desktop.pluginsSetPermission(pluginId, permission, granted)
		});

		ctx.effect(() => {
			permissions.load().catch((error: unknown) => ctx.logger.error(error));
			return () => permissions.cancelPrompts();
		}, 'plugin-permissions load decisions');
		// The stored decisions depend on the window's project: read them again when plugins change.
		ctx.desktop.on('plugins:changed', () => {
			permissions.load().catch((error: unknown) => ctx.logger.error(error));
		});

		ctx.on('plugins/permission', (request) =>
			permissions.check(request.pluginId, request.permission)
		);

		ctx.effect(
			() =>
				ctx.pluginHost.registerApi('network', {
					fetch: {
						permission: 'network',
						run: (call, params) =>
							ctx.desktop.pluginsFetch({
								pluginId: call.pluginId,
								...parseParams(fetchSchema, params)
							})
					}
				}),
			'plugin api network'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-permissions/prompt',
					region: 'overlay',
					component: PermissionPromptHost
				}),
			'plugin permission prompt'
		);
	}
};
