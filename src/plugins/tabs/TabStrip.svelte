<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { dropIndexAt } from './reorder';

	const ctx = getKernel();
	const tabs = ctx.tabs;

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

	function onPointerUp(): void {
		if (drag === null) return;
		const finished = drag;
		drag = null;
		if (finished.moved) {
			tabs.move(finished.id, finished.index);
			return;
		}
		report(tabs.activate(finished.id));
	}

	function onAuxClick(event: MouseEvent, id: string): void {
		if (event.button !== 1) return;
		event.preventDefault();
		report(tabs.close(id));
	}
</script>

<div
	bind:this={strip}
	class="app-no-drag flex min-w-0 items-end gap-0.5 self-end overflow-x-auto px-1"
	role="tablist"
	aria-label="Documents"
	data-tabs
>
	{#each tabs.tabs as tab, position (tab.id)}
		{@const active = tab.id === tabs.activeId}
		{#if drag !== null && drag.moved && drag.index === position}
			<span class="bg-action h-6 w-0.5 shrink-0 self-center rounded" data-tab-drop-marker></span>
		{/if}
		<div
			role="tab"
			tabindex="0"
			aria-selected={active}
			data-tab={tab.id}
			title={tab.path}
			class="group border-line-faint flex h-8 max-w-48 min-w-24 shrink-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs select-none"
			class:bg-canvas={active}
			class:text-default={active}
			class:text-muted={!active}
			class:hover:bg-hover={!active}
			class:opacity-60={drag !== null && drag.moved && drag.id === tab.id}
			onpointerdown={(event) => onPointerDown(event, tab.id)}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onauxclick={(event) => onAuxClick(event, tab.id)}
			onkeydown={(event) => {
				if (event.key === 'Enter') report(tabs.activate(tab.id));
			}}
		>
			<span class="min-w-0 flex-1 truncate">{tabs.nameOf(tab)}</span>
			<button
				type="button"
				data-tab-close
				aria-label="Close {tabs.nameOf(tab)}"
				class="text-faint hover:bg-raised hover:text-default inline-flex size-4 shrink-0 items-center justify-center rounded"
				onclick={() => report(tabs.close(tab.id))}
			>
				<XIcon size={10} weight="bold" />
			</button>
		</div>
	{/each}
	{#if drag !== null && drag.moved && drag.index === tabs.tabs.length}
		<span class="bg-action h-6 w-0.5 shrink-0 self-center rounded" data-tab-drop-marker></span>
	{/if}
	<button
		type="button"
		aria-label="New tab"
		class="text-muted hover:bg-hover hover:text-default mb-1 inline-flex size-6 shrink-0 items-center justify-center rounded"
		onclick={() => report(ctx.commands.run('tabs.new'))}
	>
		<PlusIcon size={12} weight="bold" />
	</button>
</div>
