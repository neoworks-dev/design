<script lang="ts">
	import type { RegionEntry } from '../registries/regions.svelte';
	import Contribution from './Contribution.svelte';
	import { getKernel } from './context';

	let { region, emptyMessage }: { region: string; emptyMessage?: string } = $props();

	const ctx = getKernel();
	// Reading `ctx.regions` inside the plugin that renders this host requires it to inject
	// `regions`. On the root context a missing service is simply undefined.
	function contributionsOf(name: string): readonly RegionEntry[] {
		if (!ctx.regions) return [];
		return ctx.regions.contributions(name);
	}

	const contributions = $derived(contributionsOf(region));
</script>

{#each contributions as entry (entry)}
	<Contribution {entry} />
{:else}
	{#if emptyMessage}
		<div
			data-region-empty={region}
			class="text-faint flex flex-1 items-center justify-center text-sm"
		>
			{emptyMessage}
		</div>
	{/if}
{/each}
