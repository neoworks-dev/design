<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import { detachInstances, goToMain } from '../../lib/components/actions';
	import { getKernel } from '../../lib/kernel/context';

	// The Design tab section of an instance, or of a layer inside one: which main component it
	// is a copy of, and the lifecycle actions.
	const ctx = getKernel();

	const instance = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		return ctx.componentSync.instanceOf(id);
	});
	const main = $derived(instance === undefined ? undefined : ctx.componentSync.mainOf(instance.id));
	const mainName = $derived(main === undefined ? 'Main component deleted' : main.name);
</script>

{#if instance !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-instance-section>
		<div class="text-violet flex items-center gap-2 text-xs">
			<DiamondIcon size={14} />
			<span class="min-w-0 flex-1 truncate font-medium" data-instance-main>{mainName}</span>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if main !== undefined}
				<Button size="sm" onclick={() => goToMain(ctx)}>Go to main component</Button>
			{/if}
			<Button size="sm" onclick={() => detachInstances(ctx)}>Detach instance</Button>
		</div>
	</div>
{/if}
