<script lang="ts">
	import { onMount } from 'svelte';
	import { boot, rootContext } from '../lib/kernel/app';
	import { provideKernel } from '../lib/kernel/context';
	import RegionHost from '../lib/kernel/RegionHost.svelte';

	provideKernel(rootContext);

	let booted = $state(false);

	// `data-ready` tells tooling (bun run qa) the app is safe to drive. It is set once every
	// plugin settled, whether or not some failed: a broken plugin must not look like a hang.
	onMount(() => {
		void boot().then(() => {
			booted = true;
			document.documentElement.dataset.ready = 'true';
		});
	});
</script>

{#if booted}
	<RegionHost region="root" emptyMessage="No layout plugin loaded" />
{/if}
