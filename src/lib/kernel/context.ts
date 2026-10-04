// How components reach the kernel: `getKernel()` returns the `ctx` of the plugin that owns the
// component being rendered. RegionHost sets it per contribution; the route sets the root context
// once. Components never import a context or a service singleton.

import type { Context } from '@neoworks/extension-system';
import { getContext, setContext } from 'svelte';

const KERNEL_KEY = Symbol('neoworks.kernel');

const MISSING_HOST_MESSAGE =
	'getKernel() called outside a kernel host: render the component through a RegionHost ' +
	'(or call provideKernel(ctx) in an ancestor) and call getKernel() during component init';

/** Make `ctx` the kernel context for this component and everything it renders. */
export function provideKernel(ctx: Context): void {
	setContext(KERNEL_KEY, ctx);
}

/** The owning plugin's context. Throws when called outside a RegionHost-rendered tree. */
export function getKernel(): Context {
	let ctx: Context | undefined;
	try {
		ctx = getContext<Context | undefined>(KERNEL_KEY);
	} catch (error) {
		throw new Error(MISSING_HOST_MESSAGE, { cause: error });
	}
	if (ctx) return ctx;
	throw new Error(MISSING_HOST_MESSAGE);
}
