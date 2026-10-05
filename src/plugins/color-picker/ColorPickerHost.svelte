<script lang="ts">
	import { untrack } from 'svelte';
	import type { RGBA } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import { variablesForScope } from '../../lib/services/colorPicker';
	import { parseHex, rgbToHex } from '../../lib/ui/colorMath';
	import ColorPickerPanel from '../../lib/ui/ColorPickerPanel.svelte';
	import Popover from '../../lib/ui/Popover.svelte';

	const ctx = getKernel();
	const state = ctx.colorPicker.state;
	const request = $derived(state.current);

	const DOCUMENT_COLOR_LIMIT = 16;

	const variables = $derived.by(() => {
		if (request === null) return [];
		const usable = variablesForScope(ctx.variables.variables(), request.scope);
		return usable.flatMap((variable) => {
			const value = ctx.variables.resolveVariable(variable.id);
			if (typeof value !== 'object') return [];
			return [{ id: variable.id, name: variable.name, color: value }];
		});
	});

	const documentColors = $derived.by(() => {
		if (request === null) return [];
		// Read once per picker: swatches must not reshuffle while a drag edits the document.
		const found: Record<string, RGBA> = {};
		for (const node of untrack(() => ctx.document.query((candidate) => 'fills' in candidate))) {
			if (!('fills' in node)) continue;
			for (const paint of node.fills) {
				if (paint.type !== 'SOLID') continue;
				found[rgbToHex(paint.color)] = { ...paint.color, a: 1 };
			}
		}
		return Object.values(found).slice(0, DOCUMENT_COLOR_LIMIT);
	});

	// Chromium's native eyedropper samples the pixel under the pointer, which is the rendered
	// canvas as the user sees it.
	function eyedropperIfAvailable(): (() => Promise<RGBA | undefined>) | undefined {
		const Native: unknown = Reflect.get(window, 'EyeDropper');
		if (typeof Native !== 'function') return undefined;
		return async () => {
			const dropper: { open: () => Promise<{ sRGBHex: string }> } = Reflect.construct(Native, []);
			try {
				const picked = await dropper.open();
				return parseHex(picked.sRGBHex);
			} catch {
				return undefined;
			}
		};
	}
</script>

{#if request !== null}
	{#key request}
		<Popover
			anchor={request.anchor}
			width={256}
			label={request.label}
			onclose={() => ctx.colorPicker.close()}
		>
			<ColorPickerPanel
				color={request.color()}
				{variables}
				boundVariableId={request.variableId?.()}
				recentColors={state.recent}
				{documentColors}
				eyedropper={eyedropperIfAvailable()}
				onchange={request.onchange}
				onbind={request.onbind}
			/>
		</Popover>
	{/key}
{/if}
