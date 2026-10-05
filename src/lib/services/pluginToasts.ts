// The `pluginToasts` service: short messages plugins show (`figma.notify`). Provided by plugin
// `plugin-figma-compat`. A toast removes itself after its timeout; a plugin may have a few at a
// time, so a loop cannot bury the canvas.

import { Service, type Context } from '@neoworks/extension-system';
import { Registry, type RegistryEntry } from '../registries/registry.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginToasts: PluginToastsService;
	}
}

export interface PluginToast extends RegistryEntry {
	pluginId: string;
	message: string;
	error: boolean;
}

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_PER_PLUGIN = 3;

export class PluginToastsService extends Service {
	readonly toasts = new Registry<PluginToast>();
	private readonly counter = { value: 0 };

	constructor(ctx: Context) {
		super(ctx, 'pluginToasts');
	}

	/** Show `message` for `timeoutMs` (default 3 s); the toast and its timer go with the plugin. */
	show(pluginId: string, message: string, error: boolean, timeoutMs?: number): void {
		const own = this.toasts.listAll().filter((toast) => toast.pluginId === pluginId);
		if (own.length >= MAX_PER_PLUGIN) return;
		let timeout = DEFAULT_TIMEOUT_MS;
		if (timeoutMs !== undefined && timeoutMs > 0) timeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
		this.counter.value += 1;
		const toast: PluginToast = {
			id: `${pluginId}#${this.counter.value}`,
			pluginId,
			message: message.slice(0, 300),
			error
		};
		this.ctx.effect(() => {
			const dispose = this.toasts.register(toast);
			const timer = setTimeout(dispose, timeout);
			return () => {
				clearTimeout(timer);
				dispose();
			};
		}, `plugin toast ${toast.id}`);
	}

	snapshotState(): Record<string, unknown> {
		return { toasts: this.toasts.listAll().length };
	}
}
