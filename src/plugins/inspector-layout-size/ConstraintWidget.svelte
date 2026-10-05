<script lang="ts">
	import { toggleConstraintSide, type ConstraintSide } from './sizing';

	// Figma's constraint box: the outer square is the parent frame, the inner one the selected
	// node. Four bars pin it to a side (both bars of an axis stretch it); the centre lines centre it.
	let {
		horizontal,
		vertical,
		onchange
	}: {
		/** Current constraint per axis, or null when the selection disagrees. */
		horizontal: string | null;
		vertical: string | null;
		onchange: (axis: 'horizontal' | 'vertical', value: string) => void;
	} = $props();

	function startOn(value: string | null): boolean {
		return value === 'MIN' || value === 'STRETCH';
	}

	function endOn(value: string | null): boolean {
		return value === 'MAX' || value === 'STRETCH';
	}

	function pressBar(axis: 'horizontal' | 'vertical', side: ConstraintSide): void {
		const current = axis === 'horizontal' ? horizontal : vertical;
		if (current === null) {
			onchange(axis, side === 'start' ? 'MIN' : 'MAX');
			return;
		}
		const next = toggleConstraintSide(current, side);
		if (next !== current) onchange(axis, next);
	}

	const bar = 'absolute rounded-full border-0 p-0 transition-colors';
	const idle = 'bg-muted opacity-40 hover:opacity-80';
	const active = 'bg-blue';

	function tone(on: boolean): string {
		if (on) return active;
		return idle;
	}
</script>

<div
	class="border-line relative size-16 shrink-0 rounded-sm border"
	role="group"
	aria-label="Constraints"
	data-constraint-widget
>
	<div class="border-line absolute inset-5 rounded-[2px] border"></div>
	<button
		type="button"
		aria-label="Left"
		aria-pressed={startOn(horizontal)}
		data-bar="left"
		class="{bar} top-5 bottom-5 left-0.5 w-1 {tone(startOn(horizontal))}"
		onclick={() => pressBar('horizontal', 'start')}
	></button>
	<button
		type="button"
		aria-label="Right"
		aria-pressed={endOn(horizontal)}
		data-bar="right"
		class="{bar} top-5 right-0.5 bottom-5 w-1 {tone(endOn(horizontal))}"
		onclick={() => pressBar('horizontal', 'end')}
	></button>
	<button
		type="button"
		aria-label="Top"
		aria-pressed={startOn(vertical)}
		data-bar="top"
		class="{bar} top-0.5 right-5 left-5 h-1 {tone(startOn(vertical))}"
		onclick={() => pressBar('vertical', 'start')}
	></button>
	<button
		type="button"
		aria-label="Bottom"
		aria-pressed={endOn(vertical)}
		data-bar="bottom"
		class="{bar} right-5 bottom-0.5 left-5 h-1 {tone(endOn(vertical))}"
		onclick={() => pressBar('vertical', 'end')}
	></button>
	<button
		type="button"
		aria-label="Center horizontally"
		aria-pressed={horizontal === 'CENTER'}
		data-bar="center-horizontal"
		class="{bar} top-7 bottom-7 left-1/2 w-1 -translate-x-1/2 {tone(horizontal === 'CENTER')}"
		onclick={() => onchange('horizontal', 'CENTER')}
	></button>
	<button
		type="button"
		aria-label="Center vertically"
		aria-pressed={vertical === 'CENTER'}
		data-bar="center-vertical"
		class="{bar} top-1/2 right-7 left-7 h-1 -translate-y-1/2 {tone(vertical === 'CENTER')}"
		onclick={() => onchange('vertical', 'CENTER')}
	></button>
</div>
