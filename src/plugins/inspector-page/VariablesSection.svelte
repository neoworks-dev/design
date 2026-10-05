<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();

	const collections = $derived(ctx.variables.collections());

	function addCollection(): void {
		ctx.variables.createCollection(`Collection ${collections.length + 1}`);
	}

	function open(): void {
		if (!ctx.commands.has('variables.open')) return;
		void ctx.commands.run('variables.open');
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-variables-section>
	<div class="flex items-center justify-between">
		<button
			type="button"
			class="text-muted hover:text-default text-xs"
			aria-label="Open variables"
			onclick={open}
		>
			Local variables
		</button>
		<IconToggleButton icon={PlusIcon} label="Add variable collection" onclick={addCollection} />
	</div>
	{#each collections as collection (collection.id)}
		<div class="flex items-center justify-between text-xs" data-variable-collection={collection.id}>
			<span class="text-default truncate">{collection.name}</span>
			<span class="text-faint tabular-nums">{collection.variableIds.length}</span>
		</div>
	{:else}
		<p class="text-faint text-xs">No variables yet</p>
	{/each}
</div>
