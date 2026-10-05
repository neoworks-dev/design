<script lang="ts">
	// One plugin surface on screen: the tree the plugin sent, or why there is none yet (the plugin
	// is starting, or it failed). Showing it is what starts a plugin that only has a panel.
	import { untrack } from 'svelte';
	import { getKernel } from '../../kernel/context';
	import SurfaceNodeView from './SurfaceNodeView.svelte';

	let { pluginId, surfaceId }: { pluginId: string; surfaceId: string } = $props();

	const ctx = getKernel();

	const entry = $derived(ctx.pluginUi.surface(pluginId, surfaceId));
	const record = $derived(ctx.pluginRegistry.get(pluginId));

	// Once per shown surface: reading the plugin's status inside must not restart a plugin that was
	// stopped on purpose, so the start request is untracked.
	$effect(() => {
		const id = pluginId;
		untrack(() => ctx.pluginUi.ensureStarted(id));
	});

	function onEvent(handler: string, value: unknown, label: string | undefined): void {
		void ctx.pluginUi.dispatch(pluginId, surfaceId, handler, value, label);
	}
</script>

<div class="flex min-w-0 flex-col gap-2 p-3" data-plugin-surface={surfaceId}>
	{#if entry && entry.tree}
		<SurfaceNodeView node={entry.tree} {onEvent} />
	{:else if record && record.status === 'failed'}
		<p role="alert" class="text-red text-xs">The plugin failed: {record.error}</p>
	{:else}
		<p class="text-faint text-xs">Starting plugin...</p>
	{/if}
</div>
