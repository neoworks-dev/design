<script lang="ts">
	import { onMount } from 'svelte';

	let {
		value,
		oncommit,
		oncancel
	}: {
		value: string;
		/** `step` is 1 for Tab, -1 for Shift+Tab, 0 for Enter and blur. */
		oncommit: (name: string, step: -1 | 0 | 1) => void;
		oncancel: () => void;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	// A key handler that ends the edit also blurs the input; the blur must not commit again.
	let finished = false;

	// The draft starts as the current name and is only the user's from then on.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);

	onMount(() => {
		input?.focus();
		input?.select();
	});

	function commit(step: -1 | 0 | 1): void {
		if (finished) return;
		finished = true;
		oncommit(draft, step);
	}

	function onkeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			commit(0);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			finished = true;
			oncancel();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			commit(event.shiftKey ? -1 : 1);
		}
	}
</script>

<input
	bind:this={input}
	bind:value={draft}
	type="text"
	aria-label="Layer name"
	data-layer-rename
	class="bg-input border-accent text-default min-w-0 flex-1 rounded-sm border px-1 text-xs outline-none"
	{onkeydown}
	onblur={() => commit(0)}
	onpointerdown={(event) => event.stopPropagation()}
	onclick={(event) => event.stopPropagation()}
	ondblclick={(event) => event.stopPropagation()}
/>
