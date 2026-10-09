<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import InlineNameInput from '../../lib/ui/InlineNameInput.svelte';
	import { FILE_DRAG_TYPE } from './dragType';
	import FileBadge from './FileBadge.svelte';

	const ctx = getKernel();
	const home = ctx.home;

	const overview = $derived(home.overview);
	const location = $derived(home.location);
	const inRoot = $derived(
		overview !== null && location.kind === 'directory' && location.path === overview.root
	);

	// The directory a dragged file card is over; it is highlighted until the drag leaves or drops.
	let dropTarget = $state<string | null>(null);

	function isAt(path: string): boolean {
		return location.kind === 'directory' && location.path === path;
	}

	function isFileDrag(event: DragEvent): boolean {
		return event.dataTransfer !== null && event.dataTransfer.types.includes(FILE_DRAG_TYPE);
	}

	function onDragOver(event: DragEvent, directory: string): void {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		dropTarget = directory;
	}

	function onDrop(event: DragEvent, directory: string): void {
		dropTarget = null;
		if (!isFileDrag(event) || event.dataTransfer === null) return;
		event.preventDefault();
		const path = event.dataTransfer.getData(FILE_DRAG_TYPE);
		if (path === '') return;
		void home.moveFile(path, directory);
	}

	function rowClass(active: boolean, hovered: boolean): string {
		if (hovered) return 'bg-raised outline-line-strong outline';
		if (active) return 'bg-raised font-medium';
		return 'hover:bg-hover';
	}

	const ROW = 'text-default flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm';
	const SECTION_HEADER = 'text-muted flex h-8 items-center px-2 text-xs font-semibold';
</script>

<nav
	class="border-line bg-elevated flex w-60 shrink-0 flex-col border-r"
	aria-label="Files"
	data-home-sidebar
>
	<div class="flex h-12 shrink-0 items-center gap-2.5 px-4">
		<FileBadge />
		<span class="text-sm font-semibold tracking-tight" data-home-wordmark>Draftboard</span>
	</div>

	<div class="px-3 pb-2">
		<label
			class="bg-input focus-within:outline-line-strong flex h-8 items-center gap-2 rounded-md px-2.5 focus-within:outline"
		>
			<MagnifyingGlassIcon size={14} class="text-faint shrink-0" />
			<input
				class="text-default placeholder:text-faint w-full bg-transparent text-sm outline-none"
				placeholder="Search files"
				aria-label="Search files"
				value={home.query}
				oninput={(event) => void home.setQuery(event.currentTarget.value)}
			/>
		</label>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="border-line-faint border-b px-2 pb-2">
			<button
				type="button"
				class="{ROW} {rowClass(location.kind === 'recents', false)}"
				aria-current={location.kind === 'recents'}
				data-home-nav="recents"
				onclick={() => void home.showRecents()}
			>
				<ClockIcon size={16} class="text-muted shrink-0" />
				<span class="min-w-0 flex-1 truncate">Recents</span>
			</button>
			{#if overview !== null}
				<button
					type="button"
					class="{ROW} {rowClass(inRoot, dropTarget === overview.root)}"
					aria-current={inRoot}
					data-home-nav="drafts"
					onclick={() => void home.showDirectory(overview.root)}
					ondragover={(event) => onDragOver(event, overview.root)}
					ondragleave={() => (dropTarget = null)}
					ondrop={(event) => onDrop(event, overview.root)}
				>
					<FileIcon size={16} class="text-muted shrink-0" />
					<span class="min-w-0 flex-1 truncate">Drafts</span>
				</button>
			{/if}
		</div>

		<div class="border-line-faint border-b px-2 py-2">
			<div class={SECTION_HEADER}>
				<span class="flex-1">Folders</span>
				<IconButton icon={PlusIcon} label="New folder" onclick={() => home.beginCreateFolder()} />
			</div>
			{#if home.creatingFolder}
				<div class="flex h-8 items-center gap-2.5 px-2" data-home-new-folder>
					<FolderIcon size={16} class="text-muted shrink-0" />
					<InlineNameInput
						value="New folder"
						ariaLabel="Folder name"
						oncommit={(name) => void home.createFolder(name)}
						oncancel={() => home.cancelCreateFolder()}
					/>
				</div>
			{/if}
			{#if overview !== null}
				{#each overview.folders as folder (folder.path)}
					{#if home.renamingPath === folder.path}
						<div class="flex h-8 items-center gap-2.5 px-2">
							<FolderIcon size={16} class="text-muted shrink-0" />
							<InlineNameInput
								value={folder.name}
								ariaLabel="Folder name"
								oncommit={(name) => void home.renameFolder(folder, name)}
								oncancel={() => home.cancelRename()}
							/>
						</div>
					{:else}
						<button
							type="button"
							class="{ROW} {rowClass(isAt(folder.path), dropTarget === folder.path)}"
							aria-current={isAt(folder.path)}
							data-home-nav-folder={folder.path}
							onclick={() => void home.showDirectory(folder.path)}
							oncontextmenu={(event) => home.openFolderMenu(event, folder)}
							ondragover={(event) => onDragOver(event, folder.path)}
							ondragleave={() => (dropTarget = null)}
							ondrop={(event) => onDrop(event, folder.path)}
						>
							<FolderIcon size={16} class="text-muted shrink-0" />
							<span class="min-w-0 flex-1 truncate">{folder.name}</span>
							<span class="text-faint text-xs">{folder.fileCount}</span>
						</button>
					{/if}
				{/each}
				{#if overview.folders.length === 0 && !home.creatingFolder}
					<p class="text-faint px-2 py-1 text-xs">Group drafts into folders.</p>
				{/if}
			{/if}
		</div>

		<div class="px-2 py-2">
			<div class={SECTION_HEADER}>
				<span class="flex-1">Linked folders</span>
				<IconButton icon={PlusIcon} label="Link a folder" onclick={() => void home.linkFolder()} />
			</div>
			{#if overview !== null}
				{#each overview.linked as linked (linked.id)}
					<button
						type="button"
						class="{ROW} {rowClass(isAt(linked.path), dropTarget === linked.path)}"
						class:h-auto={!linked.available}
						class:py-1={!linked.available}
						class:opacity-50={!linked.available}
						aria-current={isAt(linked.path)}
						title={linked.available ? linked.path : `${linked.path} was not found`}
						data-home-nav-linked={linked.id}
						onclick={() => {
							if (linked.available) void home.showDirectory(linked.path);
						}}
						oncontextmenu={(event) => home.openLinkedMenu(event, linked)}
						ondragover={(event) => {
							if (linked.available) onDragOver(event, linked.path);
						}}
						ondragleave={() => (dropTarget = null)}
						ondrop={(event) => {
							if (linked.available) onDrop(event, linked.path);
						}}
					>
						<LinkSimpleIcon size={16} class="text-muted shrink-0" />
						<span class="min-w-0 flex-1">
							<span class="block truncate">{linked.name}</span>
							{#if !linked.available}
								<span class="text-faint block truncate text-xs">Folder not found</span>
							{/if}
						</span>
					</button>
				{/each}
				{#if overview.linked.length === 0}
					<p class="text-faint px-2 py-1 text-xs">Show design files from any folder on disk.</p>
				{/if}
			{/if}
		</div>
	</div>

	<div class="border-line-faint border-t p-3">
		<Button full variant="ghost" icon={FolderOpenIcon} onclick={() => void home.openFromDisk()}
			>Open file...</Button
		>
	</div>
</nav>
