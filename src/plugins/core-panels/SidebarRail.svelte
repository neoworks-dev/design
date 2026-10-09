<script lang="ts">
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import { getKernel } from '../../lib/kernel/context';

	let { side }: { side: 'left' | 'right' } = $props();

	const ctx = getKernel();

	const tabs = $derived(ctx.panels.tabs(side));
	const active = $derived(ctx.panels.activeTab(side));
	const collapsed = $derived(ctx.contextKeys.get(`sidebar.${side}.collapsed`) === true);

	// The first tab and any later ones form one group; a tab ordered 100 or higher (plugin tabs)
	// starts the lower group, like Figma's second rail section.
	const LOWER_GROUP_ORDER = 100;

	function isGroupStart(index: number): boolean {
		if (index === 0) return false;
		const order = tabs[index].order ?? 0;
		const previousOrder = tabs[index - 1].order ?? 0;
		return order >= LOWER_GROUP_ORDER && previousOrder < LOWER_GROUP_ORDER;
	}

	function select(tabId: string): void {
		if (active?.id === tabId && !collapsed) {
			void ctx.commands.run(`workbench-layout.toggle-${side}-sidebar`);
			return;
		}
		ctx.panels.activateTab(tabId);
	}
</script>

<div
	role="tablist"
	aria-orientation="vertical"
	aria-label="{side} sidebar"
	class="flex w-12 flex-col items-center gap-1 py-2"
	data-panels-rail={side}
>
	{#each tabs as tab, index (tab.id)}
		{@const Icon = tab.icon ?? SquaresFourIcon}
		{#if isGroupStart(index)}
			<div class="bg-line-faint my-1 h-px w-6" role="separator"></div>
		{/if}
		<button
			type="button"
			role="tab"
			aria-selected={active?.id === tab.id && !collapsed}
			aria-label={tab.title}
			title={tab.title}
			data-panel-tab={tab.id}
			class={[
				'flex size-8 items-center justify-center rounded-md',
				active?.id === tab.id && !collapsed
					? 'bg-blue-soft text-default'
					: 'text-muted hover:bg-hover hover:text-default'
			]}
			onclick={() => select(tab.id)}
		>
			<Icon size={18} />
		</button>
	{/each}
</div>
