<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const palette = ctx.aiPalette;

	const running = $derived(palette.running);
	const answer = $derived(palette.answer);
</script>

{#if running || answer !== ''}
	<div
		class="bg-elevated border-line text-default pointer-events-auto absolute bottom-20 left-1/2 z-20 flex max-w-96 -translate-x-1/2 items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-xs shadow-lg"
		data-ai-palette-toast
	>
		{#if running}
			<span>Working on it…</span>
			<Button size="sm" variant="ghost" onclick={() => void palette.cancel()}>Stop</Button>
		{:else}
			<span class="min-w-0">{answer}</span>
			<button
				type="button"
				class="text-muted hover:text-default shrink-0 p-1"
				aria-label="Close"
				onclick={() => palette.dismiss()}
			>
				<XIcon size={12} />
			</button>
		{/if}
	</div>
{/if}
