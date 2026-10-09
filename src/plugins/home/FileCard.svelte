<script lang="ts">
	import type { LibraryFile } from '../../../electron/bridge';
	import { getKernel } from '../../lib/kernel/context';
	import InlineNameInput from '../../lib/ui/InlineNameInput.svelte';
	import { FILE_DRAG_TYPE } from './dragType';
	import FileBadge from './FileBadge.svelte';
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

{#snippet name(size: 'grid' | 'list')}
	{#if renaming}
		<InlineNameInput
			value={file.name}
			ariaLabel="File name"
			oncommit={(next) => void home.renameFile(file, next)}
			oncancel={() => home.cancelRename()}
		/>
	{:else}
		<button
			type="button"
			class="text-default block w-full truncate text-left font-medium"
			class:text-sm={size === 'grid'}
			class:text-xs={size === 'list'}
			data-home-name
			onclick={openAfterDelay}
			ondblclick={beginRename}
		>
			{file.name}
		</button>
	{/if}
{/snippet}

{#if layout === 'grid'}
	<div
		class="group border-line bg-elevated hover:border-line-strong overflow-hidden rounded-md border transition-colors"
		role="listitem"
		draggable="true"
		data-home-entry={file.path}
		ondragstart={onDragStart}
		oncontextmenu={(event) => home.openFileMenu(event, file)}
	>
		<button
			type="button"
			class="border-line block aspect-[16/9] w-full border-b"
			aria-label="Open {file.name}"
			onclick={open}
		>
			<Thumbnail thumbnail={file.thumbnail} name={file.name} />
		</button>
		<div class="flex items-center gap-3 px-4 py-3">
			<FileBadge />
			<div class="min-w-0 flex-1">
				{@render name('grid')}
				<div class="text-muted mt-0.5 truncate text-xs">
					{subtitle}{#if location !== ''}<span class="text-faint">&nbsp;· {location}</span>{/if}
				</div>
			</div>
		</div>
	</div>
{:else}
	<div
		class="hover:bg-hover border-line-faint grid h-14 grid-cols-[minmax(0,1fr)_12rem_10rem] items-center gap-4 rounded-md border-b px-2"
		role="listitem"
		draggable="true"
		data-home-entry={file.path}
		ondragstart={onDragStart}
		oncontextmenu={(event) => home.openFileMenu(event, file)}
	>
		<div class="flex min-w-0 items-center gap-3">
			<button
				type="button"
				class="border-line h-9 w-14 shrink-0 overflow-hidden rounded border"
				aria-label="Open {file.name}"
				onclick={open}
			>
				<Thumbnail thumbnail={file.thumbnail} name={file.name} compact />
			</button>
			<div class="min-w-0 flex-1">{@render name('list')}</div>
		</div>
		<span class="text-muted truncate text-xs">{location}</span>
		<span class="text-muted truncate text-xs">{subtitle}</span>
	</div>
{/if}
