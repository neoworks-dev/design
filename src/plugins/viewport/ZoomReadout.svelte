<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	const percent = $derived(Math.round(ctx.viewport.zoom * 100));
</script>

<!-- Zoom level of the canvas; a click resets to 100 percent. -->
<button
	type="button"
	class="text-muted hover:bg-hover hover:text-default app-no-drag my-1.5 shrink-0 rounded-md px-2 text-xs tabular-nums"
	aria-label="Zoom level, click for 100 percent"
	data-zoom-readout
	onclick={() => void ctx.commands.run('viewport.zoom-100')}
>
	{percent}%
</button>
