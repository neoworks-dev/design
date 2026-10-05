<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { isComponentLike, layerIcon } from '../../lib/layers/layerIcon';
	import type { LayerRow } from '../../lib/layers/tree';

	let { row, top }: { row: LayerRow; top: number } = $props();

	const ctx = getKernel();

	const INDENT_PIXELS = 14;

	const node = $derived(ctx.document.get(row.id));
	const selected = $derived(ctx.selection.has(row.id));
	const icon = $derived(node ? layerIcon(node) : undefined);
	const componentColoured = $derived(node ? isComponentLike(node) : false);
	// Instance children are real nodes linked to their main component: shown dimmed.
	const linked = $derived(node ? node.componentRef !== undefined : false);

	function onclick(event: MouseEvent): void {
		ctx.layers.clickRow(row.id, {
			shiftKey: event.shiftKey,
			toggleKey: event.ctrlKey || event.metaKey
		});
	}

	function onchevron(event: MouseEvent): void {
		event.stopPropagation();
		if (event.altKey) ctx.layers.toggleExpandedDeep(row.id);
		else ctx.layers.toggleExpanded(row.id);
	}
</script>

{#if node}
	{@const Icon = icon}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		role="treeitem"
		tabindex="-1"
		aria-selected={selected}
		aria-expanded={row.hasChildren ? row.expanded : undefined}
		data-layer-row={row.id}
		class={[
			'absolute right-0 left-0 flex h-7 cursor-default items-center pr-2 text-xs select-none',
			selected ? 'bg-blue-soft text-default' : 'hover:bg-hover text-default',
			componentColoured && 'text-violet',
			linked && !componentColoured && 'text-muted'
		]}
		style:top="{top}px"
		style:padding-left="{row.depth * INDENT_PIXELS + 4}px"
		{onclick}
		onpointerenter={() => ctx.selection.setHover(row.id)}
		onpointerleave={() => ctx.selection.setHover(null)}
		oncontextmenu={(event) => ctx.contextMenus.openOnLayer(event, row.id)}
	>
		<span class="flex size-4 shrink-0 items-center justify-center">
			{#if row.hasChildren}
				<button
					type="button"
					tabindex="-1"
					aria-label={row.expanded ? 'Collapse' : 'Expand'}
					data-layer-chevron
					class="text-muted hover:text-default flex size-4 items-center justify-center"
					onclick={onchevron}
				>
					{#if row.expanded}
						<CaretDownIcon size={10} weight="bold" />
					{:else}
						<CaretRightIcon size={10} weight="bold" />
					{/if}
				</button>
			{/if}
		</span>
		<span class="mr-1.5 flex size-4 shrink-0 items-center justify-center">
			{#if Icon}<Icon size={13} />{/if}
		</span>
		<span class="min-w-0 flex-1 truncate" data-layer-name>{node.name}</span>
	</div>
{/if}
