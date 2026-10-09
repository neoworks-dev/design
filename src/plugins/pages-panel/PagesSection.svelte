<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { PAGE_ROW_HEIGHT } from '../../lib/pages/pageDrop';
	import InlineNameInput from '../../lib/ui/InlineNameInput.svelte';

	const ctx = getKernel();

	const MAX_VISIBLE_ROWS = 6;
	const DRAG_THRESHOLD_PIXELS = 4;

	const pages = $derived(ctx.pagesPanel.pages());
	const current = $derived(ctx.pagesPanel.currentPageId);
	const drag = $derived(ctx.pagesPanel.drag);

	let list: HTMLElement | undefined = $state();
	let press: { pageId: string; pointerId: number; x: number; y: number } | undefined;

	function pointerdown(event: PointerEvent, pageId: string): void {
		if (event.button !== 0) return;
		press = { pageId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
	}

	function pointermove(event: PointerEvent): void {
		if (!press || !list) return;
		if (drag === null) {
			const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
			if (moved < DRAG_THRESHOLD_PIXELS) return;
			ctx.pagesPanel.beginDrag(press.pageId);
			list.setPointerCapture(press.pointerId);
		}
		const box = list.getBoundingClientRect();
		ctx.pagesPanel.updateDrag(event.clientY - box.top + list.scrollTop);
	}

	function pointerup(event: PointerEvent): void {
		if (list?.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
		press = undefined;
		if (ctx.pagesPanel.drag !== null) ctx.pagesPanel.commitDrag();
	}

	function pointercancel(): void {
		press = undefined;
		ctx.pagesPanel.cancelDrag();
	}

	// Esc cancels a drag; the listener exists only while one is running.
	$effect(() => {
		if (drag === null) return;
		const dispose = ctx.effect(() => {
			const onkeydown = (event: KeyboardEvent): void => {
				if (event.key !== 'Escape') return;
				event.stopPropagation();
				pointercancel();
			};
			window.addEventListener('keydown', onkeydown, true);
			return () => window.removeEventListener('keydown', onkeydown, true);
		}, 'pages-panel/drag-escape');
		return () => void dispose();
	});
</script>

<div
	bind:this={list}
	role="listbox"
	tabindex="-1"
	aria-label="Pages"
	class="relative overflow-y-auto pb-2"
	style:max-height="{MAX_VISIBLE_ROWS * PAGE_ROW_HEIGHT + 8}px"
	data-pages-list
	onpointermove={pointermove}
	onpointerup={pointerup}
	onpointercancel={pointercancel}
>
	{#each pages as page (page.id)}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			role="option"
			tabindex="-1"
			aria-selected={page.id === current}
			data-page-row={page.id}
			class={[
				'mx-2 flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm select-none',
				page.id === current ? 'bg-hover text-default font-semibold' : 'text-default hover:bg-hover',
				drag?.pageId === page.id && 'opacity-50'
			]}
			onpointerdown={(event) => pointerdown(event, page.id)}
			onclick={() => ctx.pagesPanel.switchTo(page.id)}
			ondblclick={() => ctx.pagesPanel.startRename(page.id)}
			oncontextmenu={(event) => ctx.menus.openFromEvent('page', event, { pageId: page.id })}
		>
			{#if ctx.pagesPanel.renamingId === page.id}
				<InlineNameInput
					value={page.name}
					ariaLabel="Page name"
					oncommit={(name) => ctx.pagesPanel.commitRename(name)}
					oncancel={() => ctx.pagesPanel.stopRename()}
				/>
			{:else}
				<span class="min-w-0 flex-1 truncate" data-page-name>{page.name}</span>
			{/if}
		</div>
	{/each}
	{#if drag}
		<div
			class="bg-blue pointer-events-none absolute right-2 left-2 h-0.5 rounded-full"
			style:top="{drag.slot * PAGE_ROW_HEIGHT - 1}px"
			data-page-drop-line
		></div>
	{/if}
</div>
