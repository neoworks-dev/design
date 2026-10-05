<script lang="ts">
	import { Button, Select } from '@neoworks-dev/ui';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import type { LibraryFile } from '../../../electron/bridge';
	import { locationLabel, relativeAge, type HomeSort } from '../../lib/home/library';
	import { getKernel } from '../../lib/kernel/context';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import FileCard from './FileCard.svelte';
	import FolderCard from './FolderCard.svelte';
	import HomeSidebar from './HomeSidebar.svelte';

	const ctx = getKernel();
	const home = ctx.home;

	const SORTS: { value: HomeSort; label: string }[] = [
		{ value: 'edited', label: 'Last edited' },
		{ value: 'opened', label: 'Last opened' },
		{ value: 'name', label: 'Name' }
	];

	let now = $state(Date.now());

	// Reload whenever the screen appears, so a file saved or removed meanwhile is current.
	$effect(() => {
		if (!home.visible) return;
		now = Date.now();
		void home.refresh();
	});

	const files = $derived(home.files());
	const folders = $derived(home.folders());
	const crumbs = $derived(home.breadcrumbs);
	const nothingToShow = $derived(files.length === 0 && folders.length === 0);

	function subtitleOf(file: LibraryFile): string {
		if (home.inRecents && !home.searching) {
			const opened = file.openedAt === null ? file.modifiedAt : file.openedAt;
			return `Opened ${relativeAge(opened, now)}`;
		}
		return `Edited ${relativeAge(file.modifiedAt, now)}`;
	}

	function placeOf(file: LibraryFile): string {
		if (home.view === 'list' || home.searching || home.inRecents) {
			return locationLabel(file, home.overview);
		}
		return '';
	}

	function emptyTitle(): string {
		if (home.searching) return `No files match "${home.query.trim()}"`;
		if (home.inRecents) return 'No recent files';
		if (home.inLinkedFolder) return 'This folder has no design files';
		const crumb = crumbs[crumbs.length - 1];
		if (crumb !== undefined && crumb.label === 'Drafts') return 'No files yet';
		return 'This folder is empty';
	}

	function emptyHint(): string {
		if (home.searching) return 'Try another name.';
		if (home.inRecents) return 'Files you open show up here.';
		return 'Create a design file to get started.';
	}

	function showCreateButton(): boolean {
		return !home.searching && !home.inRecents;
	}
</script>

{#if home.visible}
	<div
		class="bg-canvas text-default pointer-events-auto fixed inset-x-0 top-10 bottom-0 z-40 flex"
		data-home
		role="region"
		aria-label="Home"
	>
		<HomeSidebar />

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="border-line-faint flex h-14 shrink-0 items-center gap-3 border-b px-6">
				<h1 class="flex min-w-0 items-center gap-1.5 text-sm font-semibold" data-home-title>
					{#if home.searching}
						<span class="truncate">Results for "{home.query.trim()}"</span>
					{:else if home.inRecents}
						<span>Recents</span>
					{:else}
						{#each crumbs as crumb, position (crumb.path)}
							{#if position > 0}
								<CaretRightIcon size={10} class="text-faint shrink-0" />
							{/if}
							{#if position < crumbs.length - 1}
								<button
									type="button"
									class="text-muted hover:text-default truncate"
									onclick={() => void home.showDirectory(crumb.path)}
								>
									{crumb.label}
								</button>
							{:else}
								<span class="truncate">{crumb.label}</span>
							{/if}
						{/each}
					{/if}
				</h1>
				<div class="flex-1"></div>
				<div class="w-36">
					<Select
						size="sm"
						value={home.sort}
						options={SORTS}
						onChange={(next) => {
							if (next === 'edited' || next === 'opened' || next === 'name') home.setSort(next);
						}}
					/>
				</div>
				<ToggleGroup
					name="Layout"
					value={home.view}
					options={[
						{ value: 'grid', label: 'Grid', icon: SquaresFourIcon },
						{ value: 'list', label: 'List', icon: ListIcon }
					]}
					onchange={(next) => {
						if (next === 'grid' || next === 'list') home.setView(next);
					}}
				/>
				<Button variant="primary" icon={PlusIcon} onclick={() => void home.newFile()}>
					New design file
				</Button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto p-6">
				{#if nothingToShow}
					<div
						class="text-muted flex h-full flex-col items-center justify-center gap-2 text-sm"
						data-home-empty
					>
						<p class="text-default font-medium">{emptyTitle()}</p>
						<p>{emptyHint()}</p>
						{#if showCreateButton()}
							<div class="mt-2">
								<Button variant="primary" icon={PlusIcon} onclick={() => void home.newFile()}>
									New design file
								</Button>
							</div>
						{/if}
					</div>
				{:else if home.view === 'grid'}
					<ul
						class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
						role="list"
						data-home-grid
					>
						{#each folders as folder (folder.path)}
							<FolderCard {folder} layout="grid" />
						{/each}
						{#each files as file (file.path)}
							<FileCard {file} layout="grid" subtitle={subtitleOf(file)} location={placeOf(file)} />
						{/each}
					</ul>
				{:else}
					<ul class="flex flex-col" role="list" data-home-list>
						{#each folders as folder (folder.path)}
							<FolderCard {folder} layout="list" />
						{/each}
						{#each files as file (file.path)}
							<FileCard {file} layout="list" subtitle={subtitleOf(file)} location={placeOf(file)} />
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		{#if home.pendingTrash !== null}
			{@const pending = home.pendingTrash}
			<div
				class="absolute inset-0 z-10 flex items-center justify-center bg-black/50"
				role="presentation"
				data-home-trash-backdrop
			>
				<div
					class="bg-elevated border-line w-96 rounded-lg border p-5 shadow-lg"
					role="alertdialog"
					aria-modal="true"
					aria-label="Move to trash"
				>
					<h2 class="mb-1 text-sm font-semibold">Move "{pending.name}" to the trash?</h2>
					<p class="text-muted mb-4 text-xs">
						{#if pending.kind === 'folder'}
							The folder and every file in it go to the trash. You can restore them from there.
						{:else}
							You can restore the file from the trash.
						{/if}
					</p>
					<div class="flex justify-end gap-2">
						<Button onclick={() => home.cancelTrash()}>Cancel</Button>
						<Button variant="danger" onclick={() => void home.confirmTrash()}>Move to trash</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
