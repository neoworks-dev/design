<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { isReadyForDev } from './readyForDev';

	const ctx = getKernel();

	const readyNodes = $derived(
		ctx.document.query((node) => isReadyForDev(node), ctx.document.currentPageId)
	);
</script>

<div class="flex flex-col gap-0.5 px-3 pb-3" data-ready-for-dev-list>
	{#each readyNodes as node (node.id)}
		<button
			type="button"
			class={[
				'hover:bg-hover truncate rounded px-2 py-1 text-left text-xs',
				ctx.selection.ids.includes(node.id) ? 'text-default bg-raised' : 'text-muted'
			]}
			onclick={() => ctx.selection.select([node.id])}
		>
			{node.name}
		</button>
	{:else}
		<p class="text-faint text-xs">No frames marked as ready for dev</p>
	{/each}
</div>
