<script lang="ts">
	import type { Context } from '@neoworks/extension-system';
	import { provideKernel } from '../context';
	import RegionHost from '../RegionHost.svelte';

	let { ctx, region, emptyMessage }: { ctx: Context; region: string; emptyMessage?: string } =
		$props();

	// svelte-ignore state_referenced_locally
	provideKernel(ctx);
</script>

<RegionHost {region} {emptyMessage} />
