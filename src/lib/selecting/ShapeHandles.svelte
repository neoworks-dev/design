<script lang="ts">
	import { transformPoint } from '../document';
	import { getKernel } from '../kernel/context';
	import type { ShapeHandleFeedbackState } from './shapeHandleFeedback.svelte';
	import type { ShapeHandleGesture } from './shapeHandleGesture';
	import { shapeHandles, type ShapeHandle } from './shapeHandles';

	let { feedback, gesture }: { feedback: ShapeHandleFeedbackState; gesture: ShapeHandleGesture } =
		$props();

	const ctx = getKernel();
	const HANDLE_RADIUS = 5;

	let surface: SVGSVGElement | undefined = $state();

	const selectedId = $derived.by(() => {
		const ids = ctx.selection.ids;
		if (ids.length !== 1) return undefined;
		return ids[0];
	});
	const node = $derived.by(() => {
		if (selectedId === undefined) return undefined;
		return ctx.document.get(selectedId);
	});
	const visible = $derived(ctx.tools.activeId() === 'move' || gesture.isActive);

	/** Screen pixels per local unit of the node, along its own x axis. */
	const pixelsPerUnit = $derived.by(() => {
		if (selectedId === undefined || node === undefined) return 1;
		const [[a], [b]] = ctx.document.absoluteTransform(selectedId);
		return ctx.viewport.zoom * Math.hypot(a, b);
	});

	const handles = $derived.by(() => {
		if (!visible || selectedId === undefined || node === undefined) return [];
		const absolute = ctx.document.absoluteTransform(selectedId);
		return shapeHandles(node, pixelsPerUnit).map((handle) => ({
			handle,
			point: ctx.viewport.worldToScreen(transformPoint(absolute, handle.local.x, handle.local.y))
		}));
	});
	const readout = $derived.by(() => {
		if (feedback.readout === null) return null;
		const point = ctx.viewport.worldToScreen(feedback.readout.world);
		return { x: point.x + 18, y: point.y - 14, text: feedback.readout.text };
	});

	function worldOf(event: PointerEvent): { x: number; y: number } {
		const origin = surface?.getBoundingClientRect();
		const left = origin === undefined ? 0 : origin.left;
		const top = origin === undefined ? 0 : origin.top;
		return ctx.viewport.screenToWorld({ x: event.clientX - left, y: event.clientY - top });
	}

	function press(event: PointerEvent, handle: ShapeHandle): void {
		if (event.button !== 0 || selectedId === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		if (!gesture.begin(selectedId, handle, worldOf(event), pixelsPerUnit)) return;
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent): void {
		if (gesture.isActive) gesture.update(worldOf(event), event);
	}

	function release(event: PointerEvent): void {
		if (!gesture.isActive) return;
		(event.currentTarget as Element).releasePointerCapture(event.pointerId);
		gesture.commit();
	}
</script>

<!-- Interim: shape handles as SVG in canvas pixels, until the overlay layer (#38). -->
<svg class="absolute inset-0 h-full w-full overflow-visible" bind:this={surface} data-shape-handles>
	{#each handles as { handle, point } (handle.id)}
		<circle
			class="pointer-events-auto text-blue-500"
			style:cursor="pointer"
			cx={point.x}
			cy={point.y}
			r={HANDLE_RADIUS}
			fill="white"
			stroke="currentColor"
			stroke-width="1.5"
			role="presentation"
			data-shape-handle={handle.id}
			onpointerdown={(event) => press(event, handle)}
			onpointermove={move}
			onpointerup={release}
			onpointercancel={() => gesture.cancel()}
		/>
	{/each}
	{#if readout}
		<g data-shape-readout>
			<rect
				class="text-blue-500"
				x={readout.x - 4}
				y={readout.y - 12}
				width={readout.text.length * 7 + 10}
				height="18"
				rx="4"
				fill="currentColor"
			/>
			<text x={readout.x + 1} y={readout.y + 1} font-size="11" fill="white" class="select-none"
				>{readout.text}</text
			>
		</g>
	{/if}
</svg>
