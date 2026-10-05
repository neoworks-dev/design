<script lang="ts">
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import type { Thumbnail } from '../../../electron/bridge';

	let { thumbnail, name }: { thumbnail: Thumbnail | null; name: string } = $props();

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
</script>

{#if url !== null}
	<img src={url} alt="Preview of {name}" class="size-full object-contain" draggable="false" />
{:else}
	<div class="text-faint flex size-full items-center justify-center" data-thumbnail-placeholder>
		<FileIcon size={28} />
	</div>
{/if}
