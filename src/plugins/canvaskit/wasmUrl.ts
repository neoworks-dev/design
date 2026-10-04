// The CanvasKit wasm as a build asset: vite hashes it into `_app/immutable/assets/`, the `app://`
// handler (electron/plugins/protocol.ts) serves it as `application/wasm`, and the vite dev server
// serves it directly.
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import type { WasmLocator } from '../../lib/render/canvaskit';

export const bundledWasmLocator: WasmLocator = (file) => {
	if (file.endsWith('.wasm')) return wasmUrl;
	return file;
};
