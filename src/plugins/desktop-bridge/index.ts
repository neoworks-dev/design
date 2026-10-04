// desktop-bridge: provides the `desktop` service. Uses the preload's `window.desktop` when running
// in Electron and an in-memory browser bridge otherwise.
//

import type { Context } from '@neoworks/extension-system';
import type { DesktopBridge } from '../../../electron/bridge';
import { createBrowserBridge } from '../../lib/desktop/browserBridge';
import { DesktopService } from './desktop';

declare module '@neoworks/extension-system' {
	interface Context {
		desktop: DesktopService;
	}
}

export interface DesktopBridgeConfig {
	/** Overrides detection; tests pass a fake here. */
	bridge?: DesktopBridge;
	/** Whether `bridge` talks to a real shell. Defaults to true for an explicit bridge. */
	native?: boolean;
}

/** True when the page runs inside Electron, that is the preload exposed `window.desktop`. */
function hasPreloadBridge(): boolean {
	return typeof window !== 'undefined' && window.desktop !== undefined;
}

function isNative(config: DesktopBridgeConfig | undefined): boolean {
	if (config && config.native !== undefined) return config.native;
	if (config && config.bridge) return true;
	return hasPreloadBridge();
}

/** The preload bridge if present, else the browser fallback. */
export function resolveBridge(): DesktopBridge {
	if (typeof window !== 'undefined') {
		const injected: DesktopBridge | undefined = window.desktop;
		if (injected) return injected;
	}
	return createBrowserBridge();
}

export default {
	name: 'desktop-bridge',
	inject: [],
	apply(ctx: Context, config: DesktopBridgeConfig | undefined): void {
		const bridge = config && config.bridge ? config.bridge : resolveBridge();
		new DesktopService(ctx, bridge, isNative(config));
	}
};
