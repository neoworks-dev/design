<script lang="ts">
	import type { Paint, Style } from '../document';
	import { paintCss } from '../editing/paints';

	// The small picture of a style in lists and pickers: a paint swatch, "Aa" for text, "fx" for
	// effects, "#" for layout grids.
	let { style }: { style: Style } = $props();

	const paint = $derived.by(() => {
		if (style.type !== 'PAINT' || !Array.isArray(style.value)) return null;
		const [first] = style.value as Paint[];
		if (first === undefined) return null;
		return first;
	});

	const glyph = $derived.by(() => {
		if (style.type === 'TEXT') return 'Aa';
		if (style.type === 'EFFECT') return 'fx';
		return '#';
	});
</script>

{#if paint !== null}
	<span
		class="border-line size-5 shrink-0 rounded border"
		style:background={paintCss(paint)}
		data-style-preview="paint"
	></span>
{:else}
	<span
		class="border-line text-muted flex size-5 shrink-0 items-center justify-center rounded border text-[10px]"
		data-style-preview={style.type.toLowerCase()}
	>
		{glyph}
	</span>
{/if}
