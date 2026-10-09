<script lang="ts">
	import type { Component } from 'svelte';

	let {
		icon: Icon,
		label,
		pressed = undefined,
		disabled = false,
		title = undefined,
		filled = false,
		compact = false,
		onclick
	}: {
		// phosphor-svelte icons accept more props than `size` and `weight`
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
		/** The accessible name. */
		label: string;
		/** Toggle state (`aria-pressed`); leave undefined for a plain action button. */
		pressed?: boolean;
		disabled?: boolean;
		/** Tooltip; defaults to the label. Use it to say why a button is disabled. */
		title?: string;
		/** Sits on the field background (Figma's third-column buttons) instead of the panel. */
		filled?: boolean;
		/** 24 px instead of 32 px, for the eye and minus buttons at the end of a list row. */
		compact?: boolean;
		onclick: (event: MouseEvent) => void;
	} = $props();
</script>

<!-- A compact square icon button for dense inspector rows. -->
<button
	type="button"
	aria-label={label}
	aria-pressed={pressed}
	title={title === undefined ? label : title}
	{disabled}
	class={[
		'flex shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40',
		compact ? 'size-6' : 'size-8',
		filled && pressed !== true && 'bg-input',
		pressed === true
			? 'bg-hover text-default'
			: 'text-muted hover:bg-hover hover:text-default disabled:hover:bg-transparent'
	]}
	{onclick}
>
	<Icon size={14} />
</button>
