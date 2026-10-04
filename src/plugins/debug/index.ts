import type { Context } from '@neoworks/extension-system';
import type { BootReport } from '../../lib/kernel/boot.svelte';
import { currentEnvironment, isDebugEnabled } from './enabled';
import { DEBUG_SERVICE_NAMES, createSurface, type DesignDebug } from './surface';

export interface DebugConfig {
	/** Overrides detection (tests). By default: dev server or a `?qa=1` QA session. */
	enabled?: boolean;
}

function isEnabled(config: DebugConfig | undefined): boolean {
	if (config && config.enabled !== undefined) return config.enabled;
	return isDebugEnabled(currentEnvironment());
}

// Installs `window.__design_debug` (see surface.ts). It injects nothing, so it is ACTIVE from the
// first moment; each service is picked up through its own inject block as it appears and
// removed from the surface when it goes away.
export default {
	name: 'debug',
	inject: [],
	apply(ctx: Context, config?: DebugConfig): void {
		if (!isEnabled(config)) return;

		let bootReport: BootReport | undefined;
		ctx.on('kernel/booted', (report) => {
			bootReport = report;
		});

		const surface = createSurface(ctx.root, { bootReport: () => bootReport });

		ctx.effect(() => {
			Reflect.set(window, '__design_debug', surface);
			return () => {
				const installed: unknown = Reflect.get(window, '__design_debug');
				if (installed === surface) Reflect.deleteProperty(window, '__design_debug');
			};
		}, 'debug/window.__design_debug');

		for (const name of DEBUG_SERVICE_NAMES) {
			ctx.inject([name], (withService) => {
				const service: unknown = Reflect.get(withService, name);
				withService.effect(() => exposeService(surface, name, service), `debug/service ${name}`);
			});
		}
	}
};

function exposeService(surface: DesignDebug, name: string, service: unknown): () => void {
	surface[name] = service;
	return () => {
		if (surface[name] === service) Reflect.deleteProperty(surface, name);
	};
}
