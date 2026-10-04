<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';

	let { children } = $props();

	// Signals tooling (bun run qa) that the app has booted and is safe to drive.
	onMount(() => {
		document.documentElement.dataset.ready = 'true';
	});
</script>

<div class="bg-canvas text-default flex h-screen w-screen flex-col overflow-hidden">
	{@render children()}
</div>
