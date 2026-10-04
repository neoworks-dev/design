<script lang="ts">
	import { getKernel } from '../kernel/context';
	import { cursorFor, handleBox, handleWorldPoint, sizeLabel } from './handles';
	import { HANDLE_IDS, type HandleId } from './resize';
	import type { ResizeFeedbackState } from './resizeFeedback.svelte';
	import type { ResizeGesture } from './resizeGesture';
	import type { RotateGesture } from './rotateGesture';

	interface Props {
		feedback: ResizeFeedbackState;
		gesture: ResizeGesture;
		/** Rotation zones outside the corner handles; omitted where the tool cannot rotate. */
		rotation?: RotateGesture;
		/** The tool this instance of the handles belongs to. */
		toolId?: string;
	}

	let { feedback, gesture, rotation, toolId = 'move' }: Props = $props();

	const ctx = getKernel();
	const HANDLE_SIZE = 8;
	const HIT_SIZE = 16;
	const ZONE_RADIUS = 13;
	const ZONE_OFFSET = 15;
	const CORNERS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'];
	const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>'
	)}") 12 12, grab`;

	let surface: SVGSVGElement | undefined = $state();

	const box = $derived(handleBox(ctx.document.reader, ctx.selection.ids));
	const visible = $derived(
		ctx.tools.activeId() === toolId || gesture.isActive || rotation?.isActive === true
	);
	const zones = $derived.by(() => {
		if (box === undefined || rotation === undefined) return [];
		const first = handleWorldPoint(box, 'nw');
		const opposite = handleWorldPoint(box, 'se');
		const centre = ctx.viewport.worldToScreen({
			x: (first.x + opposite.x) / 2,
			y: (first.y + opposite.y) / 2
		});
		return CORNERS.map((id) => {
			const corner = ctx.viewport.worldToScreen(handleWorldPoint(box, id));
			const length = Math.hypot(corner.x - centre.x, corner.y - centre.y) || 1;
			return {
				id,
				x: corner.x + ((corner.x - centre.x) / length) * ZONE_OFFSET,
				y: corner.y + ((corner.y - centre.y) / length) * ZONE_OFFSET
			};
		});
	});
	const handles = $derived.by(() => {
		if (box === undefined) return [];
		return HANDLE_IDS.map((id) => ({
			id,
			point: ctx.viewport.worldToScreen(handleWorldPoint(box, id))
		}));
	});
	const pill = $derived.by(() => {
		if (box === undefined) return null;
		const bottom = ctx.viewport.worldToScreen(handleWorldPoint(box, 's'));
		if (feedback.angle !== null) {
			return { x: bottom.x, y: bottom.y + 22, label: `${Math.round(feedback.angle)}\u00b0` };
		}
		if (feedback.size === null) return null;
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

	function pressZone(event: PointerEvent): void {
		if (rotation === undefined || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (!rotation.begin(worldOf(event))) return;
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}

	function moveZone(event: PointerEvent): void {
		if (rotation?.isActive) rotation.update(worldOf(event), event);
	}

	function releaseZone(event: PointerEvent): void {
		if (!rotation?.isActive) return;
		(event.currentTarget as Element).releasePointerCapture(event.pointerId);
		rotation.commit();
	}
</script>

<!-- Interim: handles and the size pill as SVG in canvas pixels, until the overlay layer (#38). -->
<svg
	class="absolute inset-0 h-full w-full overflow-visible"
	bind:this={surface}
	data-transform-handles
>
	{#if visible}
		{#each zones as zone (zone.id)}
			<circle
				class="pointer-events-auto"
				style:cursor={ROTATE_CURSOR}
				cx={zone.x}
				cy={zone.y}
				r={ZONE_RADIUS}
				fill="transparent"
				role="presentation"
				data-rotate-zone={zone.id}
				onpointerdown={pressZone}
				onpointermove={moveZone}
				onpointerup={releaseZone}
				onpointercancel={() => rotation?.cancel()}
			/>
		{/each}
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
