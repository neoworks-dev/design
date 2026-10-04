<script lang="ts">
	import Contribution from '../../lib/kernel/Contribution.svelte';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	const overlay = $derived(ctx.tools.active?.overlayContent);
</script>

<!-- The active tool's overlay component, drawn above the canvas and below the chrome. -->
{#if overlay}
	{#key overlay}
		<div class="pointer-events-none absolute inset-0" data-tool-overlay={ctx.tools.activeId()}>
			<Contribution entry={overlay} />
		</div>
	{/key}
{/if}
