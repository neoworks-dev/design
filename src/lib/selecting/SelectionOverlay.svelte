<script lang="ts">
	import { getKernel } from '../kernel/context';
	import type { MoveToolState } from './moveTool.svelte';
	import {
		isComponentLike,
		polygonPoints,
		screenCorners,
		screenRect,
		type OutlineSource
	} from './outline';

	let { state }: { state: MoveToolState } = $props();

	const ctx = getKernel();

	const source: OutlineSource = {
		size: (id) => {
			const node = ctx.document.require(id);
			if (node.type === 'PAGE') return { width: 0, height: 0 };
			return { width: node.width, height: node.height };
		},
		absoluteTransform: (id) => ctx.document.absoluteTransform(id),
		worldToScreen: (point) => ctx.viewport.worldToScreen(point)
	};

	interface Outline {
		id: string;
		points: string;
		component: boolean;
	}

	function outlineOf(id: string): Outline {
		return {
			id,
			points: polygonPoints(screenCorners(source, id)),
			component: isComponentLike(ctx.document.require(id).type)
		};
	}

	const selected = $derived(ctx.selection.ids.filter((id) => ctx.document.has(id)).map(outlineOf));
	const hovered = $derived.by((): Outline | null => {
		const id = ctx.selection.hoverId;
		if (id === null || ctx.selection.has(id) || !ctx.document.has(id)) return null;
		return outlineOf(id);
	});
	const dropTarget = $derived.by((): Outline | null => {
		const id = state.dropTargetId;
		if (id === null || !ctx.document.has(id)) return null;
		return outlineOf(id);
	});
	const marquee = $derived.by(() => {
		if (state.marquee === null) return null;
		return screenRect(state.marquee, (point) => ctx.viewport.worldToScreen(point));
	});
	const guides = $derived(
		ctx.snapping.guides.map((guide) => {
			const vertical = guide.axis === 'x';
			const from = vertical
				? { x: guide.position, y: guide.start }
				: { x: guide.start, y: guide.position };
			const to = vertical
				? { x: guide.position, y: guide.end }
				: { x: guide.end, y: guide.position };
			return { from: ctx.viewport.worldToScreen(from), to: ctx.viewport.worldToScreen(to) };
		})
	);
</script>

<!-- Interim: selection, hover and drop-target outlines, marquee and snap guides as SVG in canvas
	pixels, until the overlay layer (#38) draws them on the canvas. -->
<svg class="absolute inset-0 h-full w-full overflow-visible" data-selection-overlay>
	{#if hovered}
		<polygon
			class="fill-none"
			class:stroke-accent={!hovered.component}
			class:stroke-violet-500={hovered.component}
			stroke-width="1"
			points={hovered.points}
			data-hover-outline={hovered.id}
		/>
	{/if}
	{#each selected as outline (outline.id)}
		<polygon
			class="fill-none"
			class:stroke-accent={!outline.component}
			class:stroke-violet-500={outline.component}
			stroke-width="1"
			points={outline.points}
			data-selection-outline={outline.id}
		/>
	{/each}
	{#if dropTarget}
		<polygon
			class="stroke-accent fill-none"
			stroke-width="2"
			points={dropTarget.points}
			data-drop-target={dropTarget.id}
		/>
	{/if}
	{#if marquee}
		<rect
			class="stroke-accent fill-accent/10"
			stroke-width="1"
			x={marquee.x}
			y={marquee.y}
			width={marquee.width}
			height={marquee.height}
			data-marquee
		/>
	{/if}
	{#each guides as guide, position (position)}
		<line
			class="stroke-red-500"
			stroke-width="1"
			x1={guide.from.x}
			y1={guide.from.y}
			x2={guide.to.x}
			y2={guide.to.y}
			data-snap-guide
		/>
	{/each}
</svg>
