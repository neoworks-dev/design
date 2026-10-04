import { symbols, type Context } from '@neoworks/extension-system';

/**
 * The context of the plugin that called a service method.
 *
 * Inside a service method `this.ctx` is a hybrid: effects attach to the caller's fiber, but
 * services resolve with the permissions of the service's own plugin, so `this.ctx.someService`
 * only works if the *provider* injected it. When a service stores a context to use later (a
 * region component's `getKernel()`), it must store the real caller, which is what this returns.
 * Falls back to `fallback` when the service was not reached through a context (tests, `new`).
 */
export function callerContext(service: object, fallback: Context): Context {
	const caller: unknown = Reflect.get(service, symbols.caller);
	if (caller === undefined || caller === null) return fallback;
	return caller as Context;
}
