<script lang="ts">
	import type { CreationPreview } from './creationTool.svelte';

	let { preview }: { preview: CreationPreview } = $props();

	const shape = $derived(preview.shape);
	const round = $derived(preview.nodeType === 'ELLIPSE');
</script>

<!-- The outline of the shape being dragged out, in canvas pixels (tool overlay). -->
{#if shape && shape.kind === 'box'}
	<div
		class="border-accent bg-accent/10 absolute border"
		class:rounded-full={round}
		data-creation-preview="box"
		style:left="{shape.rect.x}px"
		style:top="{shape.rect.y}px"
		style:width="{shape.rect.width}px"
		style:height="{shape.rect.height}px"
	></div>
{:else if shape && shape.kind === 'line'}
	<svg class="absolute inset-0 h-full w-full overflow-visible" data-creation-preview="line">
		<line
			class="stroke-accent"
			stroke-width="1.5"
			x1={shape.from.x}
			y1={shape.from.y}
			x2={shape.to.x}
			y2={shape.to.y}
		/>
	</svg>
{/if}
