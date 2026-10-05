<script lang="ts">
	import FlagIcon from 'phosphor-svelte/lib/FlagIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();
	const flows = $derived(ctx.prototyping.flows());

	function nodeName(nodeId: string): string {
		const node = ctx.document.get(nodeId);
		if (node === undefined) return '';
		return node.name;
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-flows-section>
	{#if flows.length === 0}
		<span class="text-faint text-xs">Select a top-level frame and add it as a starting point.</span>
	{/if}
	{#each flows as flow (flow.nodeId)}
		<div class="flex items-center gap-1" data-flow-row={flow.nodeId}>
			<FlagIcon size={12} class="text-muted shrink-0" />
			<div class="flex min-w-0 flex-1 flex-col">
				<input
					type="text"
					aria-label="Flow name"
					class="text-default w-full bg-transparent text-xs outline-none"
					value={flow.name}
					onchange={(event) => ctx.prototyping.renameFlow(flow.nodeId, event.currentTarget.value)}
				/>
				<span class="text-faint truncate text-xs">{nodeName(flow.nodeId)}</span>
			</div>
			<IconToggleButton
				icon={MinusIcon}
				label="Remove flow {flow.name}"
				onclick={() => ctx.prototyping.removeFlow(flow.nodeId)}
			/>
		</div>
	{/each}
</div>
