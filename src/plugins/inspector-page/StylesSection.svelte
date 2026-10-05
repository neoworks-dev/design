<script lang="ts">
	import type { Style, StyleType } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import { colorToHex } from '../../lib/ui/color';

	const ctx = getKernel();

	const TYPE_LABELS: Record<StyleType, string> = {
		PAINT: 'Color',
		TEXT: 'Text',
		EFFECT: 'Effect',
		GRID: 'Grid'
	};

	const styles = $derived(Object.values(ctx.document.reader.document.styles));

	function swatch(style: Style): string | null {
		if (style.type !== 'PAINT' || !Array.isArray(style.value)) return null;
		const [first] = style.value;
		if (typeof first !== 'object' || first === null) return null;
		const color: unknown = Reflect.get(first, 'color');
		if (typeof color !== 'object' || color === null) return null;
		const { r, g, b } = color as { r: number; g: number; b: number };
		return colorToHex({ r, g, b });
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-styles-section>
	{#each styles as style (style.id)}
		{@const color = swatch(style)}
		<div class="flex items-center gap-2 text-xs" data-style-row={style.id}>
			{#if color !== null}
				<span class="border-line size-4 shrink-0 rounded border" style:background={color}></span>
			{/if}
			<span class="text-default min-w-0 flex-1 truncate">{style.name}</span>
			<span class="text-faint">{TYPE_LABELS[style.type]}</span>
		</div>
	{:else}
		<p class="text-faint text-xs">No local styles</p>
	{/each}
</div>
