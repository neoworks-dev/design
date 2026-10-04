// The one renderer kernel of the running app: a root Context and the call that boots the built-in
// plugins onto it. Only the route imports this. Plugins and components never import the root
// context; they receive their own `ctx` (plugin argument, or `getKernel()` in components).

import { Context } from '@neoworks/extension-system';
import { builtinPlugins } from '../../plugins';
import { bootKernel, type BootReport } from './boot.svelte';

export const rootContext = new Context();

let booting: Promise<BootReport> | undefined;

/** Boot the built-in plugins once. Later calls return the same promise. */
export function boot(): Promise<BootReport> {
	if (booting) return booting;
	booting = bootKernel(rootContext, builtinPlugins);
	return booting;
}
