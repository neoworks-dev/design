<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import type { RenderedFrame, RenderedLayer } from '../../lib/prototype/frameRender';
	import type { Hotspot } from '../../lib/prototype/hotspots';
	import type { PrototypeSession } from '../../lib/prototype/session.svelte';
	import type { TriggerKind } from '../../lib/prototype/model';

	let {
		frame,
		session,
		active
	}: {
		frame: RenderedFrame;
		session: PrototypeSession;
		/** Only the frames the user can act on listen to input and run timers. */
		active: boolean;
	} = $props();

	const ctx = getKernel();
	const DRAG_DISTANCE = 12;

	let scroller = $state<HTMLElement>();
	let hovered = new Set<string>();
	let pressStart: { x: number; y: number } | null = null;
	let dragFired = false;

	const scrolling = $derived(frame.scrollX || frame.scrollY);
	const scrollingLayers = $derived(frame.layers.filter((layer) => !layer.fixed));
	const fixedLayers = $derived(frame.layers.filter((layer) => layer.fixed));
	const scrollingSpots = $derived(frame.hotspots.filter((spot) => !spot.fixed));
	const fixedSpots = $derived(frame.hotspots.filter((spot) => spot.fixed));

	export function scrollToOffset(x: number, y: number): void {
		scroller?.scrollTo({ left: x, top: y, behavior: 'smooth' });
	}

	// After-delay interactions start when the frame appears and stop when it goes.
	$effect(() => {
		if (!active) return;
		return ctx.effect(() => {
			const timers: ReturnType<typeof setTimeout>[] = [];
			for (const spot of frame.hotspots) {
				for (const seconds of spot.timeouts) {
					timers.push(setTimeout(() => session.fire(spot.nodeId, 'AFTER_TIMEOUT'), seconds * 1000));
				}
			}
			return () => timers.forEach((timer) => clearTimeout(timer));
		}, 'prototype after-delay timers');
	});

	function spotsUnder(event: PointerEvent | MouseEvent): string[] {
		const ids: string[] = [];
		for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
			const id = element.getAttribute('data-hotspot');
			if (id !== null && !ids.includes(id)) ids.push(id);
		}
		return ids;
	}

	function fireFirst(ids: string[], kind: TriggerKind): boolean {
		for (const id of ids) {
			if (session.fire(id, kind)) return true;
		}
		return false;
	}

	function onclick(event: MouseEvent): void {
		if (!active) return;
		fireFirst(spotsUnder(event), 'ON_CLICK');
	}

	function onpointerdown(event: PointerEvent): void {
		if (!active) return;
		pressStart = { x: event.clientX, y: event.clientY };
		dragFired = false;
		fireFirst(spotsUnder(event), 'ON_PRESS');
	}

	function onpointerup(): void {
		pressStart = null;
	}

	function onpointermove(event: PointerEvent): void {
		if (!active) return;
		const ids = spotsUnder(event);
		for (const id of ids) {
			if (hovered.has(id)) continue;
			session.fire(id, 'ON_HOVER');
		}
		hovered = new Set(ids);
		if (pressStart === null || dragFired) return;
		const distance = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y);
		if (distance < DRAG_DISTANCE) return;
		dragFired = fireFirst(ids, 'ON_DRAG');
	}

	function layerStyle(layer: RenderedLayer): string {
		return `left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px`;
	}

	function spotStyle(spot: Hotspot): string {
		const { x, y, width, height } = spot.rect;
		return `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
	}
</script>

<!-- Pointer input of a played frame: hotspots are transparent boxes over the nodes that have
interactions; the handlers look up which boxes sit under the pointer, topmost first. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="absolute inset-0 overflow-hidden"
	style:background={frame.background}
	data-player-frame={frame.frameId}
	{onclick}
	{onpointerdown}
	{onpointerup}
	{onpointermove}
>
	<div
		bind:this={scroller}
		class="absolute inset-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		style:overflow-x={frame.scrollX ? 'auto' : 'hidden'}
		style:overflow-y={frame.scrollY ? 'auto' : 'hidden'}
		data-player-scroller={scrolling || undefined}
	>
		<div
			class="relative"
			style:width="{frame.contentWidth}px"
			style:height="{frame.contentHeight}px"
		>
			{#each scrollingLayers as layer (layer.url)}
				<img
					src={layer.url}
					alt=""
					draggable="false"
					class="pointer-events-none absolute max-w-none select-none"
					style={layerStyle(layer)}
				/>
			{/each}
			{#each scrollingSpots as spot (spot.nodeId)}
				<div class="absolute" data-hotspot={spot.nodeId} style={spotStyle(spot)}></div>
			{/each}
		</div>
	</div>
	{#each fixedLayers as layer (layer.url)}
		<img
			src={layer.url}
			alt=""
			draggable="false"
			class="pointer-events-none absolute max-w-none select-none"
			style={layerStyle(layer)}
		/>
	{/each}
	{#each fixedSpots as spot (spot.nodeId)}
		<div class="absolute" data-hotspot={spot.nodeId} style={spotStyle(spot)}></div>
	{/each}
</div>
