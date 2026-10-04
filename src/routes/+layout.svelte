<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { boot } from '../lib/kernel/app';

	let { children } = $props();

	// Signals tooling (bun run qa) that the app has booted and is safe to drive. Set once every
	// plugin settled, whether or not some failed: a broken plugin must not look like a hang.
	onMount(() => {
		void boot().then(() => {
			document.documentElement.dataset.ready = 'true';
		});
	});
</script>

<div class="bg-canvas text-default flex h-screen w-screen flex-col overflow-hidden">
	{@render children()}
</div>
