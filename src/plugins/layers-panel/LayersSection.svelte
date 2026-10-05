<script lang="ts">
	import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
	import { untrack } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
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

<div class="flex min-h-0 flex-1 flex-col" data-layers-panel>
	<div class="flex h-7 shrink-0 items-center justify-end gap-0.5 px-2" data-layers-actions>
		<IconAction
			icon={ArrowsInLineVerticalIcon}
			label="Collapse all layers"
			onclick={() => ctx.layers.collapseAll()}
		/>
	</div>
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
