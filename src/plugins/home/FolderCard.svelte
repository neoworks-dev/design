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

{#snippet label(size: 'grid' | 'list')}
	{#if renaming}
		<InlineNameInput
			value={folder.name}
			ariaLabel="Folder name"
			oncommit={(name) => void home.renameFolder(folder, name)}
			oncancel={() => home.cancelRename()}
		/>
	{:else}
		<span
			class="text-default block truncate font-medium"
			class:text-sm={size === 'grid'}
			class:text-xs={size === 'list'}
		>
			{folder.name}
		</span>
		{#if size === 'grid'}
			<span class="text-muted mt-0.5 block truncate text-xs">{count}</span>
		{/if}
	{/if}
{/snippet}

{#if layout === 'grid'}
	<div
		class="border-line bg-elevated hover:border-line-strong overflow-hidden rounded-md border transition-colors"
		role="listitem"
		data-home-folder={folder.path}
		oncontextmenu={(event) => home.openFolderMenu(event, folder)}
	>
		<button
			type="button"
			class="block w-full text-left"
			aria-label="Open folder {folder.name}"
			onclick={open}
		>
			<span
				class="bg-raised border-line text-faint flex aspect-[16/9] w-full items-center justify-center border-b"
			>
				<FolderIcon size={56} weight="fill" />
			</span>
			<span class="flex items-center gap-3 px-4 py-3">
				<span class="text-muted inline-flex size-6 shrink-0 items-center justify-center">
					<FolderIcon size={16} />
				</span>
				<span class="min-w-0 flex-1">{@render label('grid')}</span>
			</span>
		</button>
	</div>
{:else}
	<div
		class="hover:bg-hover border-line-faint grid h-14 grid-cols-[minmax(0,1fr)_12rem_10rem] items-center gap-4 rounded-md border-b px-2"
		role="listitem"
		data-home-folder={folder.path}
		oncontextmenu={(event) => home.openFolderMenu(event, folder)}
	>
		<button
			type="button"
			class="flex min-w-0 items-center gap-3 text-left"
			aria-label="Open folder {folder.name}"
			onclick={open}
		>
			<span
				class="bg-raised border-line text-faint flex h-9 w-14 shrink-0 items-center justify-center rounded border"
			>
				<FolderIcon size={18} weight="fill" />
			</span>
			<span class="min-w-0 flex-1">{@render label('list')}</span>
		</button>
		<span class="text-muted truncate text-xs">Folder</span>
		<span class="text-muted truncate text-xs">{count}</span>
	</div>
{/if}
