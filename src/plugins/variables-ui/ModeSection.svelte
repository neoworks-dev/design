<script lang="ts">
	import VariableModeRows from '../../lib/inspector-inputs/VariableModeRows.svelte';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	const nodeId = $derived(ctx.selection.ids[0]);
</script>

{#if nodeId !== undefined && ctx.document.has(nodeId)}
	<div class="flex flex-col gap-2 px-3 pb-3" data-variable-mode-section>
		<VariableModeRows {nodeId} />
		<button
			type="button"
			class="text-muted hover:text-default self-start text-xs"
			onclick={() => ctx.variablesUi.open()}
		>
			Edit variables
		</button>
	</div>
{/if}
