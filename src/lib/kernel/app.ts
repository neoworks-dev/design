// The one renderer kernel of the running app: a root Context and the call that boots the built-in
// plugins onto it. Only the route imports this. Plugins and components never import the root
// context; they receive their own `ctx` (plugin argument, or `getKernel()` in components).

import { Context } from '@neoworks/extension-system';
import { builtinPlugins, optionalPluginNames } from '../../plugins';
import { bootKernel, type BootReport } from './boot.svelte';
import { failingPlugins, namesToDisable, readStartupOptions } from './startup';

export const rootContext = new Context();

let booting: Promise<BootReport> | undefined;

/** Boot the built-in plugins once. Later calls return the same promise. */
export function boot(): Promise<BootReport> {
	if (booting) return booting;
	const options = readStartupOptions(location.search, localStorage);
	const plugins = options.failingPlugins ? [...builtinPlugins, ...failingPlugins] : builtinPlugins;
	const disabled = namesToDisable(plugins, optionalPluginNames, options);
	booting = bootKernel(rootContext, plugins, { disabled }).then((report) => {
		rootContext.emit('kernel/booted', report);
		return report;
	});
	return booting;
}
