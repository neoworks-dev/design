<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import {
		detachInstances,
		goToMain,
		pushOverrides,
		resetAllOverrides,
		resetGroups,
		resetOverrides,
		restoreMainComponent
	} from '../../lib/components/actions';
	import { GROUP_TITLES } from '../../lib/components/groupTitles';
	import { swapInstance } from '../../lib/components/swap';
	import { instanceOf, overriddenBelow, touchedOf } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';

	// The Design tab section of an instance, or of a layer inside one: which main component it
	// is a copy of, the lifecycle actions, and the overrides of the selection with a way to reset
	// them one group at a time, all at once, or push them to the main component.
	const ctx = getKernel();

	const selectedId = $derived(ctx.selection.primaryId);
	const instance = $derived.by(() => {
		if (selectedId === null) return undefined;
		return ctx.componentSync.instanceOf(selectedId);
	});
	const main = $derived(instance === undefined ? undefined : ctx.componentSync.mainOf(instance.id));
	const orphan = $derived(instance !== undefined && main === undefined);
	const mainName = $derived(main === undefined ? 'Main component deleted' : main.name);

	const selectedNode = $derived(selectedId === null ? undefined : ctx.document.get(selectedId));
	const selectedGroups = $derived.by(() => {
		if (selectedNode === undefined) return [];
		return touchedOf(selectedNode);
	});
	const overriddenCount = $derived.by(() => {
		if (instance === undefined) return 0;
		return overriddenBelow(ctx.document.reader, instance.id).length;
	});
	const hasOverrides = $derived(overriddenCount > 0);
	const selectionIsInstance = $derived(
		selectedId !== null && instanceOf(ctx.document.reader, selectedId)?.id === selectedId
	);

	let swapError = $state('');

	// Every other main component, a variant under its set's name.
	const swapOptions = $derived(
		ctx.componentSync
			.components()
			.filter((component) => main === undefined || component.id !== main.id)
			.map((component) => {
				let label = component.name;
				if (component.setName !== null) label = `${component.setName} / ${component.name}`;
				return { value: component.id, label };
			})
	);

	function swap(mainId: string): void {
		if (instance === undefined) return;
		try {
			swapInstance(ctx, instance.id, mainId);
			swapError = '';
		} catch (failure) {
			if (failure instanceof Error) swapError = failure.message;
		}
	}

	function compareWithMain(): void {
		ctx.panels.activateTab('inspect');
	}
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
			{#if orphan}
				<Button size="sm" onclick={() => restoreMainComponent(ctx)}>Restore main component</Button>
			{/if}
			<Button size="sm" onclick={() => detachInstances(ctx)}>Detach instance</Button>
		</div>

		{#if swapOptions.length > 0}
			<div class="flex flex-col gap-1" data-swap-instance>
				<DropdownField
					options={swapOptions}
					value={null}
					placeholder="Swap instance"
					onchange={swap}
				/>
				{#if swapError !== ''}
					<p class="text-red text-xs" role="alert">{swapError}</p>
				{/if}
			</div>
		{/if}

		{#if hasOverrides || selectedGroups.length > 0}
			<div class="flex flex-col gap-2" data-overrides>
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted">Overrides</span>
					<span class="text-violet" data-override-count>
						{overriddenCount === 1 ? '1 layer' : `${overriddenCount} layers`}
					</span>
				</div>
				{#if selectedGroups.length > 0}
					<div class="flex flex-wrap gap-1" data-selected-overrides>
						{#each selectedGroups as group (group)}
							<span
								class="text-violet bg-raised flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs"
								data-override-group={group}
							>
								{GROUP_TITLES[group]}
								<button
									type="button"
									aria-label="Reset {GROUP_TITLES[group]}"
									class="hover:bg-hover flex size-4 items-center justify-center rounded-full"
									onclick={() => resetGroups(ctx, [group])}
								>
									<XIcon size={10} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="flex flex-wrap items-center gap-2">
					{#if !selectionIsInstance && selectedGroups.length > 0}
						<Button size="sm" onclick={() => resetOverrides(ctx)}>Reset layer</Button>
					{/if}
					<Button size="sm" onclick={() => resetAllOverrides(ctx)}>Reset all overrides</Button>
					{#if main !== undefined}
						<Button size="sm" onclick={() => pushOverrides(ctx, [instance.id])}>
							Push to main component
						</Button>
					{/if}
				</div>
			</div>
		{/if}
		{#if main !== undefined}
			<Button size="sm" onclick={compareWithMain}>Compare with main</Button>
		{/if}
	</div>
{/if}
