import type { DesktopBridge } from '../electron/bridge';
import type { DesignDebug } from './plugins/debug/surface';

declare global {
	namespace App {}

	interface Window {
		desktop: DesktopBridge;
		/** Installed by the debug plugin in dev and QA sessions only. */
		__design_debug?: DesignDebug;
	}
}

export {};
