import type { DesktopBridge } from '../../../electron/bridge';

/**
 * The preload bridge, or undefined when the renderer runs in a plain browser (`bun run dev`).
 *
 * Interim seam: the renderer `desktop` service (issue #16) replaces this. Plugins that need the
 * bridge call this once in `apply` instead of reaching for `window.desktop` in components.
 */
export function resolveDesktop(): DesktopBridge | undefined {
	const bridge: unknown = Reflect.get(globalThis, 'desktop');
	if (typeof bridge !== 'object' || bridge === null) return undefined;
	return bridge as DesktopBridge;
}
