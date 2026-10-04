// desktop-bridge: provides the `desktop` service. Uses the preload's `window.desktop` when running
// in Electron and an in-memory browser bridge otherwise.
//
// NOT yet in the renderer boot list: the renderer-kernel boot (owned by another change) adds it.

import type { Plugin } from '@neoworks/extension-system';
import type { DesktopBridge } from '../../../electron/bridge';
import { createBrowserBridge } from './browserBridge';
import { DesktopService } from './desktop';

declare module '@neoworks/extension-system' {
	interface Context {
		desktop: DesktopService;
	}
}

export interface DesktopBridgeConfig {
	/** Overrides detection; tests pass a fake here. */
	bridge?: DesktopBridge;
}

/** The preload bridge if present, else the browser fallback. */
export function resolveBridge(): DesktopBridge {
	if (typeof window !== 'undefined') {
		const injected: DesktopBridge | undefined = window.desktop;
		if (injected) return injected;
	}
	return createBrowserBridge();
}

export const desktopBridgePlugin: Plugin.Object<DesktopBridgeConfig | undefined> = {
	name: 'desktop-bridge',
	apply(ctx, config) {
		const bridge = config && config.bridge ? config.bridge : resolveBridge();
		new DesktopService(ctx, bridge);
	}
};
