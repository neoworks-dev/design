// Entry point of a plugin's Web Worker (`new Worker(new URL('./bootstrap.ts', import.meta.url))`).
// The host sends the plugin's source in an `init` message; it is loaded as an ES module through a
// blob URL so the module can use the `design` global the runtime defined.

import { startPluginRuntime, type WorkerScope } from './runtime';

async function loadFromBlob(source: string): Promise<void> {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	try {
		await import(/* @vite-ignore */ url);
	} finally {
		URL.revokeObjectURL(url);
	}
}

startPluginRuntime(self as unknown as WorkerScope, loadFromBlob);
