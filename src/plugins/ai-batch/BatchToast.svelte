<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const batch = ctx.aiBatch;

	const running = $derived(batch.running);
	const notice = $derived(batch.notice);
</script>

{#if running || notice !== ''}
	<div
		class="bg-elevated border-line text-default pointer-events-auto absolute bottom-20 left-1/2 z-20 flex max-w-96 -translate-x-1/2 items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-xs shadow-lg"
		data-ai-batch-toast
	>
		{#if running}
			<span>Working on it…</span>
		{:else}
			<span class="min-w-0">{notice}</span>
			<button
				type="button"
				class="text-muted hover:text-default shrink-0 p-1"
				aria-label="Close"
				onclick={() => batch.dismiss()}
			>
				<XIcon size={12} />
			</button>
		{/if}
	</div>
{/if}
