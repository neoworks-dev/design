<script lang="ts">
	import { onMount } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import RegionHost from '../../lib/kernel/RegionHost.svelte';
	import ResizeHandle from './ResizeHandle.svelte';
	import type { SidebarSide } from './layoutState.svelte';

	const ctx = getKernel();
	const layout = ctx['workbench-layout'].state;

	let canvasElement: HTMLElement | undefined = $state();

	const hasTopBar = $derived(ctx.regions.contributions('top-bar').length > 0);

	function isSidebarShown(side: SidebarSide): boolean {
		if (layout.uiHidden || layout.isCollapsed(side)) return false;
		return ctx.regions.contributions(side).length > 0;
	}

	const showLeft = $derived(isSidebarShown('left'));
	const showRight = $derived(isSidebarShown('right'));

	// The canvas region keeps its own box (sidebars sit beside it, never over it), so the viewport
	// only needs to hear when that box changes size.
	onMount(() => {
		const element = canvasElement;
		if (!element) return;
		return ctx.effect(() => {
			const observer = new ResizeObserver(([entry]) => {
				const { width, height } = entry.contentRect;
				ctx.emit('canvas/resize', { width, height });
			});
			observer.observe(element);
			return () => observer.disconnect();
		}, 'workbench-layout/canvas-resize');
	});
</script>

<div class="bg-canvas flex min-h-0 flex-1 flex-col" data-workbench>
	{#if hasTopBar && !layout.uiHidden}
		<header class="border-line-faint bg-elevated flex h-10 shrink-0 items-stretch border-b">
			<RegionHost region="top-bar" />
		</header>
	{/if}

	<div class="flex min-h-0 flex-1">
		{#if showLeft}
			<div class="relative shrink-0" style:width="{layout.leftWidth}px">
				<aside
					class="border-line-faint bg-elevated flex h-full flex-col overflow-y-auto border-r"
					data-sidebar="left"
				>
					<RegionHost region="left" />
				</aside>
				<ResizeHandle side="left" {layout} />
			</div>
		{/if}

		<main class="relative min-w-0 flex-1">
			<div bind:this={canvasElement} class="absolute inset-0 flex" data-region="canvas">
				<RegionHost region="canvas" />
			</div>
			{#if !layout.uiHidden}
				<div
					class="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
					data-region="toolbar"
				>
					<div class="pointer-events-auto">
						<RegionHost region="toolbar" />
					</div>
				</div>
			{/if}
			<div class="pointer-events-none absolute inset-0 z-50" data-region="overlay">
				<RegionHost region="overlay" />
			</div>
		</main>

		{#if showRight}
			<div class="relative shrink-0" style:width="{layout.rightWidth}px">
				<aside
					class="border-line-faint bg-elevated flex h-full flex-col overflow-y-auto border-l"
					data-sidebar="right"
				>
					<RegionHost region="right" />
				</aside>
				<ResizeHandle side="right" {layout} />
			</div>
		{/if}
	</div>
</div>
