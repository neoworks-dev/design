<script lang="ts">
	import type { RegionEntry } from '../registries/regions.svelte';
	import { provideKernel } from './context';

	let { entry }: { entry: RegionEntry } = $props();

	// The host keys contributions by entry identity, so a replaced entry is a new instance and the
	// context captured here never goes stale.
	// svelte-ignore state_referenced_locally
	provideKernel(entry.ctx);

	const Component = $derived(entry.component);

	function reportFailure(error: unknown): void {
		entry.ctx.logger.error(error);
	}

	function describe(error: unknown): string {
		if (error instanceof Error) return error.message;
		return String(error);
	}
</script>

<svelte:boundary onerror={reportFailure}>
	<Component {...entry.props} />
	{#snippet failed(error, reset)}
		<div
			role="alert"
			data-region-error={entry.id}
			class="border-red/30 bg-red-soft text-red m-1 rounded-md border px-2 py-1 text-xs"
		>
			<strong>{entry.id}</strong> failed: {describe(error)}
			<button type="button" class="ml-1 underline" onclick={reset}>Retry</button>
		</div>
	{/snippet}
</svelte:boundary>
