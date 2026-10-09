<script lang="ts">
	import type { CreationPreview } from './creationTool.svelte';

	let { preview }: { preview: CreationPreview } = $props();

	const shape = $derived(preview.shape);
	const round = $derived(preview.nodeType === 'ELLIPSE');
</script>

<!-- The shape being dragged out, in canvas pixels (tool overlay): its fill with the selection
     outline, as Figma shows the new node while it is drawn. -->
{#if shape && shape.kind === 'box'}
	<div
		class="border-blue absolute border"
		class:rounded-full={round}
		data-creation-preview="box"
		style:background-color={preview.fill}
		style:left="{shape.rect.x}px"
		style:top="{shape.rect.y}px"
		style:width="{shape.rect.width}px"
		style:height="{shape.rect.height}px"
	></div>
{:else if shape && shape.kind === 'line'}
	<svg class="absolute inset-0 h-full w-full overflow-visible" data-creation-preview="line">
		<line
			class="stroke-blue"
			stroke-width="1.5"
			x1={shape.from.x}
			y1={shape.from.y}
			x2={shape.to.x}
			y2={shape.to.y}
		/>
	</svg>
{/if}
