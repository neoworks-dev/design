import type { ToolsService } from '../../lib/registries/tools.svelte';

/** A cursor that wins over the tool's while set, for example over a resize handle. */
export class CursorOverride {
	value = $state<string | undefined>(undefined);
}

/** Keep the canvas cursor equal to the override or the active tool's cursor; restored on dispose. */
export function bindCanvasCursor(
	tools: ToolsService,
	override: CursorOverride,
	element: HTMLCanvasElement
): () => void {
	const stop = $effect.root(() => {
		$effect(() => {
			element.style.cursor = override.value === undefined ? tools.cursor : override.value;
		});
	});
	return () => {
		stop();
		element.style.cursor = '';
	};
}
