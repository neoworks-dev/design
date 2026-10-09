<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import Contribution from '../../lib/kernel/Contribution.svelte';
	import type { PanelSide } from '../../lib/registries/panels.svelte';

	let { side }: { side: PanelSide } = $props();

	const ctx = getKernel();

	// The left sidebar is Figma-style: modes live in the rail, sections have fixed bold titles.
	const hasRail = $derived(side === 'left');

	const tabs = $derived(ctx.panels.tabs(side));
	const active = $derived(ctx.panels.activeTab(side));
	const sections = $derived.by(() => {
		if (!active) return [];
		return ctx.panels.sections(active.id);
	});
</script>

<div class="flex h-full flex-col text-sm" data-panels-sidebar={side}>
	{#if !hasRail}
		<div
			role="tablist"
			aria-label="{side} sidebar"
			class="border-line-faint flex h-10 shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-3"
		>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={active?.id === tab.id}
					data-panel-tab={tab.id}
					class="hover:bg-hover shrink-0 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap"
					class:bg-raised={active?.id === tab.id}
					class:text-default={active?.id === tab.id}
					class:text-dim={active?.id !== tab.id}
					onclick={() => ctx.panels.activateTab(tab.id)}
				>
					{tab.title}
				</button>
			{/each}
		</div>
	{/if}

	{#if active}
		<div role="tabpanel" aria-label={active.title} class="flex min-h-0 flex-1 flex-col">
			<!-- Keyed by entry: a Contribution captures its owner's ctx once, so switching tabs must
			     build a new one instead of reusing the previous tab's. -->
			{#if active.content}
				{#key active.content}
					<Contribution entry={active.content} />
				{/key}
			{/if}
			<!-- Figma-style on both sides: fixed bold titles, actions on the right, and a section with
			     nothing to show (`empty`) folds to a muted title row with its actions. -->
			{#each sections as section (section.id)}
				{@const folded = section.empty?.() === true}
				<section
					class={[
						'border-line-faint border-t first:border-t-0',
						section.fill && !folded && 'flex min-h-0 flex-1 flex-col'
					]}
					data-panel-section={section.id}
					data-folded={folded || undefined}
				>
					<h2 class="flex h-10 items-center justify-between pr-3 pl-4">
						<span class={['text-sm font-semibold', folded ? 'text-muted' : 'text-default']}>
							{section.title}
						</span>
						{#if section.actions}
							<div class="flex shrink-0 items-center gap-1" data-panel-section-actions={section.id}>
								<Contribution entry={section.actions} />
							</div>
						{/if}
					</h2>
					{#if !folded}
						<div
							class={[section.fill && 'flex min-h-0 flex-1 flex-col']}
							data-panel-section-body={section.id}
						>
							<Contribution entry={section.content} />
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>
