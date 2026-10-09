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

	function titleOf(): string {
		if (home.searching) return `Results for "${home.query.trim()}"`;
		if (home.inRecents) return 'Recents';
		const crumb = crumbs[crumbs.length - 1];
		if (crumb === undefined) return '';
		return crumb.label;
	}

	function countLabel(): string {
		const total = files.length + folders.length;
		if (total === 1) return '1 item';
		return `${total} items`;
	}

	function timeColumnLabel(): string {
		if (home.inRecents && !home.searching) return 'Last opened';
		return 'Last edited';
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
			<header class="shrink-0 px-8 pt-6">
				<!-- Parent folders as a small trail above the title, like Figma's team / project line. -->
				<nav class="text-muted mb-1 flex h-4 min-w-0 items-center gap-1 text-xs" aria-label="Path">
					{#if !home.searching && !home.inRecents}
						{#each crumbs.slice(0, -1) as crumb, position (crumb.path)}
							{#if position > 0}
								<CaretRightIcon size={10} class="text-faint shrink-0" />
							{/if}
							<button
								type="button"
								class="hover:text-default truncate"
								onclick={() => void home.showDirectory(crumb.path)}
							>
								{crumb.label}
							</button>
						{/each}
					{/if}
				</nav>
				<div class="flex items-center gap-3">
					<h1 class="min-w-0 flex-1 truncate text-2xl font-normal tracking-tight" data-home-title>
						{titleOf()}
					</h1>
					<Button variant="primary" icon={PlusIcon} onclick={() => void home.newFile()}>
						New design file
					</Button>
				</div>
				<div class="mt-6 flex h-8 items-center gap-3">
					<span class="text-muted text-xs">{countLabel()}</span>
					<div class="flex-1"></div>
					<span class="text-muted text-xs">Sort:</span>
					<div class="w-32">
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
				</div>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-8 pt-3 pb-8">
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
						class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6"
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
					<div
						class="text-muted border-line grid h-8 grid-cols-[minmax(0,1fr)_12rem_10rem] items-center gap-4 border-b px-2 text-xs"
						aria-hidden="true"
					>
						<span>Name</span>
						<span>Location</span>
						<span>{timeColumnLabel()}</span>
					</div>
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
