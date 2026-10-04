<script lang="ts">
	import { getKernel } from '../kernel/context';
	import { cursorFor, handleBox, handleWorldPoint, sizeLabel } from './handles';
	import { HANDLE_IDS, type HandleId } from './resize';
	import type { ResizeFeedbackState } from './resizeFeedback.svelte';
	import type { ResizeGesture } from './resizeGesture';

	let { feedback, gesture }: { feedback: ResizeFeedbackState; gesture: ResizeGesture } = $props();

	const ctx = getKernel();
	const HANDLE_SIZE = 8;
	const HIT_SIZE = 16;

	let surface: SVGSVGElement | undefined = $state();

	const box = $derived(handleBox(ctx.document.reader, ctx.selection.ids));
	const visible = $derived(ctx.tools.activeId() === 'move' || gesture.isActive);
	const handles = $derived.by(() => {
		if (box === undefined) return [];
		return HANDLE_IDS.map((id) => ({
			id,
			point: ctx.viewport.worldToScreen(handleWorldPoint(box, id))
		}));
	});
	const pill = $derived.by(() => {
		if (feedback.size === null || box === undefined) return null;
		const bottom = ctx.viewport.worldToScreen(handleWorldPoint(box, 's'));
		return { x: bottom.x, y: bottom.y + 22, label: sizeLabel(feedback.size) };
	});

	function worldOf(event: PointerEvent): { x: number; y: number } {
		const origin = surface?.getBoundingClientRect();
		const left = origin === undefined ? 0 : origin.left;
		const top = origin === undefined ? 0 : origin.top;
		return ctx.viewport.screenToWorld({ x: event.clientX - left, y: event.clientY - top });
	}

	function press(event: PointerEvent, handle: HandleId): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (!gesture.begin(handle, worldOf(event))) return;
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent): void {
		if (!gesture.isActive) return;
		gesture.update(worldOf(event), event);
	}

	function release(event: PointerEvent): void {
		if (!gesture.isActive) return;
		(event.currentTarget as Element).releasePointerCapture(event.pointerId);
		gesture.commit();
	}

	function abort(): void {
		gesture.cancel();
	}
</script>

<!-- Interim: handles and the size pill as SVG in canvas pixels, until the overlay layer (#38). -->
<svg
	class="absolute inset-0 h-full w-full overflow-visible"
	bind:this={surface}
	data-transform-handles
>
	{#if visible}
		{#each handles as handle (handle.id)}
			<g
				class="pointer-events-auto"
				style:cursor={cursorFor(handle.id)}
				role="presentation"
				data-handle={handle.id}
				onpointerdown={(event) => press(event, handle.id)}
				onpointermove={move}
				onpointerup={release}
				onpointercancel={abort}
			>
				<rect
					x={handle.point.x - HIT_SIZE / 2}
					y={handle.point.y - HIT_SIZE / 2}
					width={HIT_SIZE}
					height={HIT_SIZE}
					fill="transparent"
				/>
				<rect
					class="text-blue-500"
					x={handle.point.x - HANDLE_SIZE / 2}
					y={handle.point.y - HANDLE_SIZE / 2}
					width={HANDLE_SIZE}
					height={HANDLE_SIZE}
					fill="white"
					stroke="currentColor"
					stroke-width="1"
				/>
			</g>
		{/each}
	{/if}
	{#if pill}
		<g data-size-pill>
			<rect
				class="text-blue-500"
				x={pill.x - 32}
				y={pill.y - 10}
				width="64"
				height="20"
				rx="4"
				fill="currentColor"
			/>
			<text
				x={pill.x}
				y={pill.y + 4}
				text-anchor="middle"
				font-size="11"
				fill="white"
				class="select-none">{pill.label}</text
			>
		</g>
	{/if}
</svg>
