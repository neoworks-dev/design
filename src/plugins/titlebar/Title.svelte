<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { documentTitleOf, isDocumentDirty } from './documentTitle.svelte';

	const ctx = getKernel();
	const title = $derived(documentTitleOf(ctx.contextKeys));
	const dirty = $derived(isDocumentDirty(ctx.contextKeys));
	// macOS draws its traffic lights over the top-left corner of the window.
	const insetForTrafficLights = ctx.desktop.platform === 'darwin';
</script>

<!-- Double click toggles maximize like a native title bar. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="app-drag text-muted flex min-w-0 flex-1 items-center gap-3 px-3 text-xs"
	class:pl-20={insetForTrafficLights}
	data-titlebar
	ondblclick={() => void ctx.commands.run('titlebar.toggle-maximize')}
>
	<span class="text-dim shrink-0 font-medium">Neoworks Design</span>
	<span class="text-default min-w-0 flex-1 truncate text-center font-medium" data-document-title>
		{title}
		{#if dirty}
			<span class="text-amber" role="img" aria-label="Unsaved changes" data-dirty-marker>•</span>
		{/if}
	</span>
	<span class="w-24 shrink-0"></span>
</div>
