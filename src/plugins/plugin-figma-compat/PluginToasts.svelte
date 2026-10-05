<script lang="ts">
	// What plugins show with `figma.notify`: short messages above the toolbar.
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const toasts = $derived(ctx.pluginToasts.toasts.list());
</script>

{#if toasts.length > 0}
	<div
		class="pointer-events-none absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2"
	>
		{#each toasts as toast (toast.id)}
			<div
				role="status"
				class="bg-elevated border-line text-default pointer-events-auto rounded-lg border px-3 py-2 text-xs shadow-lg"
				class:text-red={toast.error}
				data-plugin-toast={toast.pluginId}
			>
				{toast.message}
			</div>
		{/each}
	</div>
{/if}
