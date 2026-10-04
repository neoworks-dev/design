import type { ToolsService } from '../../lib/registries/tools.svelte';

/** Keep the canvas cursor equal to the active tool's cursor (reactive); restored on dispose. */
export function bindCanvasCursor(tools: ToolsService, element: HTMLCanvasElement): () => void {
	const stop = $effect.root(() => {
		$effect(() => {
			element.style.cursor = tools.cursor;
		});
	});
	return () => {
		stop();
		element.style.cursor = '';
	};
}
