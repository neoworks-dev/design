<script lang="ts">
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import type { LibraryFile } from '../../../electron/bridge';
	import { getKernel } from '../../lib/kernel/context';
	import InlineNameInput from '../../lib/ui/InlineNameInput.svelte';
	import { FILE_DRAG_TYPE } from './dragType';
	import Thumbnail from './Thumbnail.svelte';

	let {
		file,
		layout,
		subtitle,
		location
	}: {
		file: LibraryFile;
		layout: 'grid' | 'list';
		/** "Edited 2 months ago" or "Opened 3 days ago". */
		subtitle: string;
		/** Where the file lives, shown in the list layout and in search results. */
		location: string;
	} = $props();

	const ctx = getKernel();
	const home = ctx.home;

	// A click on the name waits for a possible second click, which renames instead of opening.
	const NAME_CLICK_DELAY_MS = 250;
	let cancelPendingOpen: (() => unknown) | undefined;

	function cancelOpen(): void {
		cancelPendingOpen?.();
		cancelPendingOpen = undefined;
	}

	$effect(() => cancelOpen);

	const renaming = $derived(home.renamingPath === file.path);

	function open(): void {
		cancelOpen();
		void home.open(file);
	}

	function openAfterDelay(): void {
		cancelOpen();
		cancelPendingOpen = ctx.effect(() => {
			const timer = setTimeout(open, NAME_CLICK_DELAY_MS);
			return () => clearTimeout(timer);
		}, 'home/open file after a click on its name');
	}

	function beginRename(): void {
		cancelOpen();
		home.beginRename(file.path);
	}

	function onDragStart(event: DragEvent): void {
		if (event.dataTransfer === null) return;
		event.dataTransfer.setData(FILE_DRAG_TYPE, file.path);
		event.dataTransfer.effectAllowed = 'move';
	}
</script>

{#if layout === 'grid'}
	<div
		class="group border-line-faint bg-elevated hover:border-line-strong overflow-hidden rounded-lg border"
		role="listitem"
		draggable="true"
		data-home-entry={file.path}
		ondragstart={onDragStart}
		oncontextmenu={(event) => home.openFileMenu(event, file)}
	>
		<button
			type="button"
			class="bg-input block aspect-[16/10] w-full"
			aria-label="Open {file.name}"
			onclick={open}
		>
			<Thumbnail thumbnail={file.thumbnail} name={file.name} />
		</button>
		<div class="flex items-start gap-2 px-3 py-2">
			<FileIcon size={14} class="text-muted mt-0.5 shrink-0" />
			<div class="min-w-0 flex-1">
				{#if renaming}
					<InlineNameInput
						value={file.name}
						ariaLabel="File name"
						oncommit={(name) => void home.renameFile(file, name)}
						oncancel={() => home.cancelRename()}
					/>
				{:else}
					<button
						type="button"
						class="block w-full truncate text-left text-xs font-medium"
						data-home-name
						onclick={openAfterDelay}
						ondblclick={beginRename}
					>
						{file.name}
					</button>
				{/if}
				<div class="text-faint truncate text-xs">{subtitle}</div>
				{#if location !== ''}
					<div class="text-faint truncate text-xs">{location}</div>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<div
		class="hover:bg-hover border-line-faint flex items-center gap-3 border-b px-2 py-2"
		role="listitem"
		draggable="true"
		data-home-entry={file.path}
		ondragstart={onDragStart}
		oncontextmenu={(event) => home.openFileMenu(event, file)}
	>
		<button
			type="button"
			class="bg-input border-line-faint h-10 w-16 shrink-0 overflow-hidden rounded border"
			aria-label="Open {file.name}"
			onclick={open}
		>
			<Thumbnail thumbnail={file.thumbnail} name={file.name} />
		</button>
		<div class="min-w-0 flex-1">
			{#if renaming}
				<InlineNameInput
					value={file.name}
					ariaLabel="File name"
					oncommit={(name) => void home.renameFile(file, name)}
					oncancel={() => home.cancelRename()}
				/>
			{:else}
				<button
					type="button"
					class="block w-full truncate text-left text-xs font-medium"
					data-home-name
					onclick={openAfterDelay}
					ondblclick={beginRename}
				>
					{file.name}
				</button>
			{/if}
		</div>
		<span class="text-muted w-40 shrink-0 truncate text-xs">{location}</span>
		<span class="text-faint w-40 shrink-0 truncate text-xs">{subtitle}</span>
	</div>
{/if}
