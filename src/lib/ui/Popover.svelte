<script lang="ts">
	import type { Snippet } from 'svelte';

	// `@neoworks-dev/ui` has no popover yet; this is the minimal anchored one the inspector
	// sections need. Move it into the UI package (with a story) when that package grows one.
	let {
		anchor,
		label,
		width = 240,
		keepOpenOn = undefined,
		onclose,
		children
	}: {
		/** Screen rectangle of the element the popover opens from. */
		anchor: { x: number; y: number; width: number; height: number };
		/** Accessible name of the dialog. */
		label: string;
		width?: number;
		/** Presses on matching elements do not close the popover (the canvas, for handle tools). */
		keepOpenOn?: (target: Element) => boolean;
		onclose: () => void;
		children: Snippet;
	} = $props();

	let height = $state(0);

	// Opens to the left of the anchor (the inspector is the right sidebar), clamped to the window.
	const left = $derived(Math.max(8, Math.min(anchor.x - width - 8, window.innerWidth - width - 8)));
	const top = $derived(Math.max(8, Math.min(anchor.y, window.innerHeight - height - 8)));

	function closeOnOutsidePress(event: PointerEvent): void {
		if (!(event.target instanceof Element)) return;
		if (event.target.closest('[data-popover]')) return;
		// Dropdown lists are portalled to the body but belong to the popover that opened them.
		if (event.target.closest('[role="listbox"]')) return;
		if (keepOpenOn?.(event.target) === true) return;
		onclose();
	}

	function closeOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.stopPropagation();
		onclose();
	}
</script>

<svelte:window onpointerdowncapture={closeOnOutsidePress} onkeydowncapture={closeOnEscape} />

<div
	bind:offsetHeight={height}
	role="dialog"
	aria-label={label}
	data-popover={label}
	class="bg-elevated border-line pointer-events-auto fixed z-50 rounded-lg border shadow-lg"
	style:left="{left}px"
	style:top="{top}px"
	style:width="{width}px"
>
	{@render children()}
</div>
