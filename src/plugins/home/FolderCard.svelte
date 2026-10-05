<script lang="ts">
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import type { LibraryFolder } from '../../../electron/bridge';
	import { getKernel } from '../../lib/kernel/context';
	import InlineNameInput from '../../lib/ui/InlineNameInput.svelte';

	let { folder, layout }: { folder: LibraryFolder; layout: 'grid' | 'list' } = $props();

	const ctx = getKernel();
	const home = ctx.home;

	const renaming = $derived(home.renamingPath === folder.path);
	const count = $derived(folder.fileCount === 1 ? '1 file' : `${folder.fileCount} files`);

	function open(): void {
		void home.showDirectory(folder.path);
	}
</script>

{#snippet label()}
	{#if renaming}
		<InlineNameInput
			value={folder.name}
			ariaLabel="Folder name"
			oncommit={(name) => void home.renameFolder(folder, name)}
			oncancel={() => home.cancelRename()}
		/>
	{:else}
		<div class="truncate text-xs font-medium">{folder.name}</div>
		<div class="text-faint truncate text-xs">{count}</div>
	{/if}
{/snippet}

{#if layout === 'grid'}
	<div
		class="border-line-faint bg-elevated hover:border-line-strong rounded-lg border"
		role="listitem"
		data-home-folder={folder.path}
		oncontextmenu={(event) => home.openFolderMenu(event, folder)}
	>
		<button
			type="button"
			class="text-muted flex w-full items-center gap-3 px-3 py-4 text-left"
			aria-label="Open folder {folder.name}"
			onclick={open}
		>
			<FolderIcon size={28} weight="fill" class="shrink-0" />
			<span class="min-w-0 flex-1">{@render label()}</span>
		</button>
	</div>
{:else}
	<div
		class="hover:bg-hover border-line-faint flex items-center gap-3 border-b px-2 py-2"
		role="listitem"
		data-home-folder={folder.path}
		oncontextmenu={(event) => home.openFolderMenu(event, folder)}
	>
		<button
			type="button"
			class="text-muted flex min-w-0 flex-1 items-center gap-3 text-left"
			aria-label="Open folder {folder.name}"
			onclick={open}
		>
			<FolderIcon size={20} weight="fill" class="shrink-0" />
			<span class="min-w-0 flex-1">{@render label()}</span>
		</button>
	</div>
{/if}
