<script lang="ts">
	import type { ViewToolState } from './viewTools.svelte';

	let { toolState }: { toolState: ViewToolState } = $props();
</script>

{#if toolState.marquee}
	<div
		class="border-blue bg-blue/10 absolute border"
		data-zoom-marquee
		style:left="{toolState.marquee.x}px"
		style:top="{toolState.marquee.y}px"
		style:width="{toolState.marquee.width}px"
		style:height="{toolState.marquee.height}px"
	></div>
{/if}
