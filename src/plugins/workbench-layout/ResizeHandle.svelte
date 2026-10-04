<script lang="ts">
	import type { LayoutState, SidebarSide } from './layoutState.svelte';

	let { side, layout }: { side: SidebarSide; layout: LayoutState } = $props();

	const KEYBOARD_STEP = 16;

	let dragging = $state(false);

	// Sits on the outer edge of its sidebar, half outside so the hit area overlaps the canvas.
	const edgeClass = $derived(side === 'left' ? '-right-1' : '-left-1');
	const lineClass = $derived(dragging ? 'bg-blue w-0.5' : 'bg-transparent w-px');
	let startX = 0;
	let startWidth = 0;

	function startDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		dragging = true;
		startX = event.clientX;
		startWidth = layout.width(side);
	}

	function drag(event: PointerEvent): void {
		if (!dragging) return;
		const delta = event.clientX - startX;
		// The right sidebar grows when the handle moves left.
		if (side === 'left') layout.setWidth(side, startWidth + delta);
		else layout.setWidth(side, startWidth - delta);
	}

	function endDrag(): void {
		dragging = false;
	}

	function resize(event: KeyboardEvent): void {
		const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
		const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
		if (event.key === grow) layout.setWidth(side, layout.width(side) + KEYBOARD_STEP);
		else if (event.key === shrink) layout.setWidth(side, layout.width(side) - KEYBOARD_STEP);
		else if (event.key === 'Enter') layout.resetWidth(side);
		else return;
		event.preventDefault();
	}
</script>

<!--
	A wide invisible hit area around a hairline that lights up on hover and while dragging. A
	focusable separator is the WAI-ARIA "window splitter" pattern, which svelte-check does not know.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize {side} sidebar"
	aria-valuenow={layout.width(side)}
	tabindex="0"
	data-resize-handle={side}
	class="group absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none {edgeClass}"
	onpointerdown={startDrag}
	onpointermove={drag}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	ondblclick={() => layout.resetWidth(side)}
	onkeydown={resize}
>
	<div
		class="duration-fast group-hover:bg-blue mx-auto h-full transition-colors group-hover:w-0.5 {lineClass}"
	></div>
</div>
