<script lang="ts">
	import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { dropIndexAt } from './reorder';

	const ctx = getKernel();
	const tabs = ctx.tabs;
	// The home screen covers the document while it shows, so no tab reads as the current one (the
	// home plugin publishes the key; the strip never imports it).
	const homeShown = $derived(ctx.contextKeys.get('home.visible') === true);

	function isCurrent(id: string): boolean {
		return id === tabs.activeId && !homeShown;
	}

	/** A hairline between two tabs, left out next to the current tab (it has its own edge). */
	function showsSeparator(position: number): boolean {
		if (position === 0) return false;
		const before = tabs.tabs[position - 1];
		const after = tabs.tabs[position];
		if (before === undefined || after === undefined) return false;
		return !isCurrent(before.id) && !isCurrent(after.id);
	}

	const DRAG_THRESHOLD_PIXELS = 4;

	let strip: HTMLElement | undefined = $state();
	let drag = $state<{ id: string; startX: number; moved: boolean; index: number } | null>(null);

	function report(action: Promise<void>): void {
		action.catch((error: unknown) => ctx.logger.error('tabs', error));
	}

	function tabRects(): { left: number; width: number }[] {
		if (!strip) return [];
		return [...strip.querySelectorAll('[data-tab]')].map((element) => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, width: rect.width };
		});
	}

	function onPointerDown(event: PointerEvent, id: string): void {
		if (event.button !== 0) return;
		if (event.target instanceof Element && event.target.closest('[data-tab-close]')) return;
		drag = { id, startX: event.clientX, moved: false, index: -1 };
		if (event.currentTarget instanceof Element)
			event.currentTarget.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent): void {
		if (drag === null) return;
		if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PIXELS) return;
		drag = { ...drag, moved: true, index: dropIndexAt(event.clientX, tabRects()) };
	}

	function showTab(id: string): void {
		// The tab is already the live document, only hidden behind the home screen.
		if (homeShown && id === tabs.activeId) {
			report(ctx.commands.run('home.hide'));
			return;
		}
		report(tabs.activate(id));
	}

	function onPointerUp(): void {
		if (drag === null) return;
		const finished = drag;
		drag = null;
		if (finished.moved) {
			tabs.move(finished.id, finished.index);
			return;
		}
		showTab(finished.id);
	}

	function onAuxClick(event: MouseEvent, id: string): void {
		if (event.button !== 1) return;
		event.preventDefault();
		report(tabs.close(id));
	}
</script>

<div
	bind:this={strip}
	class="app-no-drag flex min-w-0 [scrollbar-width:none] items-stretch overflow-x-auto"
	role="tablist"
	aria-label="Documents"
	data-tabs
>
	{#each tabs.tabs as tab, position (tab.id)}
		{@const active = tab.id === tabs.activeId}
		{@const current = isCurrent(tab.id)}
		{#if drag !== null && drag.moved && drag.index === position}
			<span class="bg-action h-5 w-0.5 shrink-0 self-center rounded" data-tab-drop-marker></span>
		{:else if showsSeparator(position)}
			<span class="bg-line h-4 w-px shrink-0 self-center" aria-hidden="true"></span>
		{/if}
		<div
			role="tab"
			tabindex="0"
			aria-selected={active}
			data-tab={tab.id}
			title={tab.path}
			class="group relative flex max-w-56 min-w-32 shrink-0 cursor-default items-center gap-2 pr-1.5 pl-3 text-xs select-none"
			class:bg-canvas={current}
			class:text-default={current}
			class:text-muted={!current}
			class:hover:bg-hover={!current}
			class:hover:text-default={!current}
			class:opacity-60={drag !== null && drag.moved && drag.id === tab.id}
			onpointerdown={(event) => onPointerDown(event, tab.id)}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onauxclick={(event) => onAuxClick(event, tab.id)}
			onkeydown={(event) => {
				if (event.key === 'Enter') showTab(tab.id);
			}}
		>
			<span class="inline-flex shrink-0" class:text-blue={current} class:text-faint={!current}>
				<PenNibIcon size={12} weight={current ? 'fill' : 'regular'} />
			</span>
			<span class="min-w-0 flex-1 truncate" class:font-medium={current}>{tabs.nameOf(tab)}</span>
			<button
				type="button"
				data-tab-close
				aria-label="Close {tabs.nameOf(tab)}"
				class="text-muted hover:bg-raised hover:text-default inline-flex size-5 shrink-0 items-center justify-center rounded group-hover:opacity-100 focus-visible:opacity-100"
				class:opacity-0={!current}
				onclick={() => report(tabs.close(tab.id))}
			>
				<XIcon size={10} weight="bold" />
			</button>
		</div>
	{/each}
	{#if drag !== null && drag.moved && drag.index === tabs.tabs.length}
		<span class="bg-action h-5 w-0.5 shrink-0 self-center rounded" data-tab-drop-marker></span>
	{/if}
	<button
		type="button"
		aria-label="New tab"
		class="text-muted hover:bg-hover hover:text-default mx-1 inline-flex size-7 shrink-0 items-center justify-center self-center rounded"
		onclick={() => report(ctx.commands.run('tabs.new'))}
	>
		<PlusIcon size={12} weight="bold" />
	</button>
</div>
