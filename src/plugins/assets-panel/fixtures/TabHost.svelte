<script lang="ts">
	import type { Context } from '@neoworks/extension-system';
	import { provideKernel } from '../../../lib/kernel/context';
	import AssetsTab from '../AssetsTab.svelte';

	let { ctx }: { ctx: Context } = $props();

	// svelte-ignore state_referenced_locally
	provideKernel(ctx);
</script>

<AssetsTab />
