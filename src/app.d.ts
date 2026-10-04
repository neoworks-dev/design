import type { DesktopBridge } from '../electron/bridge';

declare global {
	namespace App {}

	interface Window {
		desktop: DesktopBridge;
	}
}

export {};
