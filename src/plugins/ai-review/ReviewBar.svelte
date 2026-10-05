<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const review = ctx.aiReview;

	const pending = $derived(review.pending());
	const layerCount = $derived(review.pendingNodeIds().length);
	const title = $derived.by(() => {
		if (pending.length === 1) return pending[0].label;
		return `${pending.length} AI runs`;
	});
	let failure = $state('');

	function reject(): void {
		failure = '';
		try {
			review.rejectAll();
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
	}
</script>

{#if pending.length > 0}
	<div
		class="bg-elevated border-line text-default pointer-events-auto absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg"
		data-ai-review
	>
		<div class="flex max-w-64 min-w-0 flex-col">
			<span class="truncate font-medium">Review AI changes</span>
			<span class="text-muted truncate"
				>{title}: {layerCount} layer{layerCount === 1 ? '' : 's'}</span
			>
			{#if failure !== ''}
				<span class="text-red">{failure}</span>
			{/if}
		</div>
		<Button size="sm" variant="ghost" onclick={reject}>Reject</Button>
		<Button size="sm" variant="primary" onclick={() => review.acceptAll()}>Accept</Button>
	</div>
{/if}
