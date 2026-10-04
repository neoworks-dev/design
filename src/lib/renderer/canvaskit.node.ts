// Node-side locator for tests and headless export: the wasm sits next to canvaskit.js.

import { createRequire } from 'node:module';
import path from 'node:path';
import type { WasmLocator } from './canvaskit';

export function nodeWasmLocator(): WasmLocator {
	const require = createRequire(import.meta.url);
	const directory = path.dirname(require.resolve('canvaskit-wasm/bin/canvaskit.js'));
	return (file) => path.join(directory, file);
}
