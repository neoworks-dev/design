// Loading the CanvasKit wasm module. One function, three environments, the only difference being
// where the `.wasm` file is found:
//
// - Electron `app://`: the build emits the wasm as a hashed asset; the plugin passes its URL.
// - vite dev server: same import, served by vite.
// - vitest / Node: a filesystem path (see nodeWasmLocator in canvaskit.node.ts).

import type { CanvasKit } from 'canvaskit-wasm';

export type { CanvasKit } from 'canvaskit-wasm';

/** Maps a file CanvasKit asks for (`canvaskit.wasm`) to a URL or path it can load. */
export type WasmLocator = (file: string) => string;

export async function loadCanvasKit(locateFile: WasmLocator): Promise<CanvasKit> {
	const loaded = await import('canvaskit-wasm');
	return loaded.default({ locateFile });
}
