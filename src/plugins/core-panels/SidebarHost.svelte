<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { getKernel } from '../../lib/kernel/context';
	import Contribution from '../../lib/kernel/Contribution.svelte';
	import type { PanelSide } from '../../lib/registries/panels.svelte';

	let { side }: { side: PanelSide } = $props();

	const ctx = getKernel();

	const tabs = $derived(ctx.panels.tabs(side));
	const active = $derived(ctx.panels.activeTab(side));
	const sections = $derived.by(() => {
		if (!active) return [];
		return ctx.panels.sections(active.id);
	});
</script>

<div class="flex h-full flex-col text-sm" data-panels-sidebar={side}>
	<div
		role="tablist"
		aria-label="{side} sidebar"
		class="border-line-faint flex h-10 shrink-0 items-center gap-1 border-b px-3"
	>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				aria-selected={active?.id === tab.id}
				data-panel-tab={tab.id}
				class="hover:bg-hover rounded-md px-2 py-1 text-xs font-medium"
				class:bg-raised={active?.id === tab.id}
				class:text-default={active?.id === tab.id}
				class:text-dim={active?.id !== tab.id}
				onclick={() => ctx.panels.activateTab(tab.id)}
			>
				{tab.title}
			</button>
		{/each}
	</div>

	{#if active}
		<div role="tabpanel" aria-label={active.title} class="flex min-h-0 flex-1 flex-col">
			{#if active.content}
				<Contribution entry={active.content} />
			{/if}
			{#each sections as section (section.id)}
				{@const collapsed = ctx.panels.isSectionCollapsed(section)}
				<section class="border-line-faint border-b" data-panel-section={section.id}>
					<h2 class="flex h-10 items-center">
						<button
							type="button"
							aria-expanded={!collapsed}
							class="text-muted hover:text-default flex h-full w-full items-center gap-1.5 px-3 text-left text-xs font-semibold"
							onclick={() => ctx.panels.toggleSection(section)}
						>
							{#if collapsed}
								<CaretRightIcon size={12} />
							{:else}
								<CaretDownIcon size={12} />
							{/if}
							{section.title}
						</button>
					</h2>
					{#if !collapsed}
						<div data-panel-section-body={section.id}>
							<Contribution entry={section.content} />
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>
