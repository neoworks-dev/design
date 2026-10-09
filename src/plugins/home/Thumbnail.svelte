<script lang="ts">
	import type { Thumbnail } from '../../../electron/bridge';
	import FileBadge from './FileBadge.svelte';

	let {
		thumbnail,
		name,
		compact = false
	}: {
		thumbnail: Thumbnail | null;
		name: string;
		/** The small list-row preview: less margin around the design. */
		compact?: boolean;
	} = $props();

	let url = $state<string | null>(null);

	// The bytes come over IPC; an object URL shows them and is released with the image.
	$effect(() => {
		if (thumbnail === null) {
			url = null;
			return;
		}
		const created = URL.createObjectURL(
			new Blob([new Uint8Array(thumbnail.bytes)], { type: thumbnail.mime })
		);
		url = created;
		return () => URL.revokeObjectURL(created);
	});

	function paddingClass(): string {
		if (compact) return 'p-1';
		return 'p-[12%]';
	}
</script>

<!-- Like Figma: the design sits centred on a page-coloured backdrop with room around it, never
     stretched to the card's edges. -->
<div class="bg-raised flex size-full items-center justify-center {paddingClass()}">
	{#if url !== null}
		<img
			src={url}
			alt="Preview of {name}"
			class="max-h-full max-w-full object-contain shadow-sm"
			draggable="false"
		/>
	{:else}
		<span class="opacity-60" data-thumbnail-placeholder><FileBadge size="sm" /></span>
	{/if}
</div>
