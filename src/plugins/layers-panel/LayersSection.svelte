<script lang="ts">
	import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import { tick, untrack } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import { LAYER_TYPE_FILTERS } from '../../lib/layers/rowActions';
	import { LAYER_ROW_HEIGHT } from '../../lib/layers/tree';
	import IconAction from './IconAction.svelte';
	import { createDragGesture } from './dragGesture';
	import LayerRow from './LayerRow.svelte';

	const ctx = getKernel();

	const OVERSCAN_ROWS = 6;
	const INDENT_PIXELS = 14;
	const AUTO_EXPAND_DELAY_MILLISECONDS = 600;

	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	let scroller: HTMLElement | undefined = $state();
	let searchInput: HTMLInputElement | undefined = $state();

	const rows = $derived(ctx.layers.rows());
	const firstIndex = $derived(
		Math.max(0, Math.floor(scrollTop / LAYER_ROW_HEIGHT) - OVERSCAN_ROWS)
	);
	const lastIndex = $derived(
		Math.min(
			rows.length,
			Math.ceil((scrollTop + viewportHeight) / LAYER_ROW_HEIGHT) + OVERSCAN_ROWS
		)
	);
	const windowed = $derived(rows.slice(firstIndex, lastIndex));

	// Canvas selection reveals its rows: expand the ancestors, then scroll the first one in view.
	// Only the selection is tracked; the expansion state is written, never read, so collapsing a
	// parent by hand is not undone.
	const gesture = createDragGesture(ctx, { scroller: () => scroller, indentPixels: INDENT_PIXELS });
	const indicator = $derived(ctx.layers.drag?.drop?.indicator);
	const insideRowIndex = $derived.by(() => {
		if (indicator?.kind !== 'inside') return -1;
		const rowId = indicator.rowId;
		return rows.findIndex((row) => row.id === rowId);
	});

	// Hovering a collapsed container while dragging opens it after a short delay.
	$effect(() => {
		if (indicator?.kind !== 'inside') return;
		const rowId = indicator.rowId;
		const dispose = ctx.effect(() => {
			const timer = setTimeout(
				() => ctx.layers.setExpanded(rowId, true),
				AUTO_EXPAND_DELAY_MILLISECONDS
			);
			return () => clearTimeout(timer);
		}, 'layers-panel/auto-expand');
		return () => void dispose();
	});

	$effect(() => {
		const ids = ctx.selection.ids;
		untrack(() => {
			ctx.layers.reveal(ids);
			scrollToFirst(ids);
		});
	});

	// Renaming a row (Ctrl+R, Tab to the next layer) brings it into view.
	$effect(() => {
		const id = ctx.layers.renamingId;
		if (id === null) return;
		untrack(() => scrollToFirst([id]));
	});

	// Opening the search from anywhere (header button, Ctrl+F) focuses its field.
	$effect(() => {
		if (!ctx.layers.filterOpen) return;
		void tick().then(() => searchInput?.focus());
	});

	function onkeydown(event: KeyboardEvent): void {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
		event.preventDefault();
		event.stopPropagation();
		ctx.layers.openFilter();
		searchInput?.focus();
	}

	function onsearchkeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key !== 'Escape') return;
		event.preventDefault();
		ctx.layers.closeFilter();
	}

	function scrollToFirst(ids: readonly string[]): void {
		if (!scroller || ids.length === 0) return;
		const wanted = new Set(ids);
		const index = rows.findIndex((row) => wanted.has(row.id));
		if (index < 0) return;
		const rowTop = index * LAYER_ROW_HEIGHT;
		const rowBottom = rowTop + LAYER_ROW_HEIGHT;
		const visibleTop = scroller.scrollTop;
		const visibleBottom = visibleTop + scroller.clientHeight;
		if (rowTop >= visibleTop && rowBottom <= visibleBottom) return;
		scroller.scrollTop = Math.max(0, rowTop - scroller.clientHeight / 2);
	}
</script>

<!-- Ctrl+F is only the layers' while focus is inside the panel, so the key goes unhandled here. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex min-h-0 flex-1 flex-col" data-layers-panel {onkeydown}>
	<div class="flex h-7 shrink-0 items-center justify-end gap-0.5 px-2" data-layers-actions>
		<IconAction
			icon={MagnifyingGlassIcon}
			label="Search layers"
			pressed={ctx.layers.filterOpen}
			onclick={() => (ctx.layers.filterOpen ? ctx.layers.closeFilter() : ctx.layers.openFilter())}
		/>
		<IconAction
			icon={ArrowsInLineVerticalIcon}
			label="Collapse all layers"
			onclick={() => ctx.layers.collapseAll()}
		/>
	</div>
	{#if ctx.layers.filterOpen}
		<div class="flex shrink-0 flex-col gap-1.5 px-2 pb-2" data-layers-filter>
			<input
				bind:this={searchInput}
				type="search"
				aria-label="Filter layers by name"
				placeholder="Search layers"
				value={ctx.layers.filter.query}
				oninput={(event) => ctx.layers.setQuery(event.currentTarget.value)}
				onkeydown={onsearchkeydown}
				class="bg-input border-line text-default placeholder:text-faint focus:border-blue h-7 w-full rounded-md border px-2 text-xs outline-none"
			/>
			<div class="flex flex-wrap gap-1" role="group" aria-label="Filter by type">
				{#each LAYER_TYPE_FILTERS as chip (chip.id)}
					{@const active = ctx.layers.filter.types.includes(chip.id)}
					<button
						type="button"
						aria-pressed={active}
						data-layer-filter-chip={chip.id}
						class={[
							'rounded-full border px-2 py-0.5 text-[11px]',
							active
								? 'border-blue bg-blue-soft text-default'
								: 'border-line text-muted hover:bg-hover'
						]}
						onclick={() => ctx.layers.toggleType(chip.id)}
					>
						{chip.title}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div
		bind:this={scroller}
		bind:clientHeight={viewportHeight}
		role="tree"
		tabindex="0"
		aria-label="Layers"
		aria-multiselectable="true"
		class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2"
		data-layers-scroller
		onpointerdown={gesture.pointerdown}
		onpointermove={gesture.pointermove}
		onpointerup={gesture.pointerup}
		onpointercancel={gesture.pointercancel}
		onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
		oncontextmenu={(event) => {
			if (event.target === event.currentTarget) ctx.contextMenus.openOnLayerPanel(event);
		}}
	>
		<div class="relative" style:height="{rows.length * LAYER_ROW_HEIGHT}px">
			{#each windowed as row, offset (row.id)}
				<LayerRow {row} top={(firstIndex + offset) * LAYER_ROW_HEIGHT} />
			{/each}
			{#if indicator?.kind === 'line'}
				<div
					class="bg-blue pointer-events-none absolute right-2 h-0.5 rounded-full"
					style:top="{indicator.rowBoundary * LAYER_ROW_HEIGHT - 1}px"
					style:left="{indicator.depth * INDENT_PIXELS + 4}px"
					data-layer-drop-line
				></div>
			{:else if insideRowIndex >= 0}
				<div
					class="border-blue pointer-events-none absolute right-1 left-1 rounded-md border-2"
					style:top="{insideRowIndex * LAYER_ROW_HEIGHT}px"
					style:height="{LAYER_ROW_HEIGHT}px"
					data-layer-drop-inside
				></div>
			{/if}
		</div>
	</div>
</div>
