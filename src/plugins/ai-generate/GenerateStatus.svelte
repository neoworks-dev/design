<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const generate = ctx.aiGenerate;

	const running = $derived(generate.running);
	const notice = $derived(generate.notice);
</script>

{#if running || notice !== ''}
	<div
		class="bg-elevated border-line text-default pointer-events-auto absolute bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-xs shadow-lg"
		data-ai-generate-status
	>
		{#if running}
			<span>Generating design…</span>
			<Button size="sm" variant="ghost" onclick={() => void generate.cancel()}>Stop</Button>
		{:else}
			<span>{notice}</span>
			<button
				type="button"
				class="text-muted hover:text-default p-1"
				aria-label="Close"
				onclick={() => generate.dismiss()}
			>
				<XIcon size={12} />
			</button>
		{/if}
	</div>
{/if}
