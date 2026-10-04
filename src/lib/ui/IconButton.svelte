<script lang="ts">
	import type { Component } from 'svelte';

	type Variant = 'ghost' | 'primary';

	// Local stand-in for `@neoworks-dev/ui` Button, which has no way to set an accessible name
	// (no aria-label, no rest props) and linked packages are not edited from this repo. Same
	// variants and tokens as Button's `round` form; replace it when Button accepts `label`.
	let {
		icon: Icon,
		label,
		variant = 'ghost',
		pressed = undefined,
		locked = false,
		onclick = undefined,
		ondblclick = undefined
	}: {
		// phosphor-svelte icons accept more props than `size` and `weight`
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
		/** The accessible name; also what a screen reader announces for the button. */
		label: string;
		variant?: Variant;
		/** Toggle state (`aria-pressed`) for buttons that stay selected, such as the active tool. */
		pressed?: boolean;
		/** Shown as a ring around the button (tool lock). */
		locked?: boolean;
		onclick?: (event: MouseEvent) => void;
		ondblclick?: (event: MouseEvent) => void;
	} = $props();

	const variantClasses: Record<Variant, string> = {
		primary: 'bg-action text-action-fg hover:opacity-90',
		ghost: 'bg-transparent text-muted hover:bg-hover hover:text-default'
	};
</script>

<button
	type="button"
	aria-label={label}
	aria-pressed={pressed}
	data-locked={locked || undefined}
	class={[
		'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transparent text-xs font-semibold transition-colors select-none',
		variantClasses[variant],
		locked && 'ring-action ring-offset-elevated ring-2 ring-offset-2'
	]}
	{onclick}
	{ondblclick}
>
	<Icon size={14} weight="bold" />
</button>
