import type { Context } from '@neoworks/extension-system';
import type { PluginList } from '../../../electron/bridge';
import { PluginLoader } from '../../lib/plugins/loader';
import { STUB_CONTRIBUTORS } from '../../lib/plugins/stubs';
import { PluginRegistryService } from '../../lib/services/pluginRegistry';

// Third-party plugins, part two (#154): provides `pluginRegistry`, validates the manifests main
// found (path-level errors for broken ones, API version check, shadowing, trust) and mounts one
// fiber per loadable plugin. Its `contributes` entries become lazy stubs registered through the
// ordinary services; running one asks the plugin host (#155) to start the plugin's worker.
//
// The stub contributors (lib/plugins/stubs.ts) are a fixed list; one that needs a service of
// another plugin (panels and inspectors need `pluginUi`) names it in `needs`, so a plugin's fiber
// simply waits for that service like any plugin would.
export default {
	name: 'plugin-manifests',
	inject: ['desktop'],
	apply(ctx: Context): void {
		const registry = new PluginRegistryService(ctx);
		const loader = new PluginLoader(ctx, registry, STUB_CONTRIBUTORS);

		let alive = true;
		ctx.effect(
			() => () => {
				alive = false;
			},
			'plugin-manifests alive'
		);
		const adopt = (list: PluginList): void => {
			if (!alive) return;
			const records = registry.ingest(list);
			loader.sync(records).catch((error: unknown) => ctx.logger.error(error));
		};

		ctx.desktop.on('plugins:changed', adopt);
		ctx.desktop
			.pluginsList()
			.then(adopt)
			.catch((error: unknown) => ctx.logger.error(error));

		ctx.effect(() => () => loader.unmountAll(), 'plugin-manifests unload plugins');
	}
};
