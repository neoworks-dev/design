<script lang="ts">
	import type { Component } from 'svelte';

	// A small square icon button for panel headers and row actions. `@neoworks-dev/ui` Button has
	// no accessible name and only round 36px forms, so this stays a local stand-in.
	let {
		icon: Icon,
		label,
		pressed = undefined,
		onclick
	}: {
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
		label: string;
		pressed?: boolean;
		onclick: (event: MouseEvent) => void;
	} = $props();
</script>

<button
	type="button"
	aria-label={label}
	title={label}
	aria-pressed={pressed}
	class={[
		'hover:bg-hover hover:text-default flex size-6 items-center justify-center rounded-md',
		pressed ? 'bg-raised text-default' : 'text-muted'
	]}
	{onclick}
>
	<Icon size={14} />
</button>
