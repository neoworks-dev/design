<script lang="ts">
	import { Button, Select } from '@neoworks-dev/ui';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import FolderSimpleIcon from 'phosphor-svelte/lib/FolderSimpleIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { Component } from 'svelte';
	import type { HomeEntry, HomeSection, HomeSort } from '../../lib/home/entries';
	import { relativeTime } from '../../lib/home/format';
	import { getKernel } from '../../lib/kernel/context';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import Thumbnail from './Thumbnail.svelte';

	const ctx = getKernel();
	const home = ctx.home;

	interface SectionLink {
		id: HomeSection;
		label: string;
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
	}
	const SECTIONS: SectionLink[] = [
		{ id: 'recents', label: 'Recents', icon: ClockIcon },
		{ id: 'drafts', label: 'Drafts', icon: FolderSimpleIcon },
		{ id: 'all', label: 'All files', icon: FilesIcon }
	];
	const SORTS: { value: HomeSort; label: string }[] = [
		{ value: 'recent', label: 'Last opened' },
		{ value: 'name', label: 'Name' }
	];

	// Reload whenever the screen appears, so a file saved or removed meanwhile is current.
	$effect(() => {
		if (!home.visible) return;
		home.refresh().catch((error: unknown) => ctx.logger.error('home', error));
	});

	const entries = $derived(home.entries());
	const sectionLabel = $derived(SECTIONS.find((link) => link.id === home.section)?.label);
	const now = Date.now();

	function report(action: Promise<void>): void {
		action.catch((error: unknown) => ctx.logger.error('home', error));
	}

	function emptyMessage(): string {
		if (home.query.trim() !== '') return `No files match "${home.query.trim()}".`;
		if (home.section === 'drafts') return 'No drafts. Unsaved documents with edits show up here.';
		return 'No files yet. Create a design file or open one from disk.';
	}

	function subtitle(entry: HomeEntry): string {
		if (entry.kind === 'draft') return `Draft, edited ${relativeTime(entry.timestamp, now)}`;
		return `Opened ${relativeTime(entry.timestamp, now)}`;
	}
</script>

{#if home.visible}
	<div
		class="bg-canvas text-default pointer-events-auto fixed inset-x-0 top-10 bottom-0 z-40 flex"
		data-home
		role="region"
		aria-label="Home"
	>
		<nav class="border-line-faint bg-elevated w-56 shrink-0 border-r p-3" aria-label="Files">
			<div class="mb-3">
				<Button full variant="primary" icon={PlusIcon} onclick={() => report(home.newFile())}>
					New design file
				</Button>
			</div>
			<div class="mb-4">
				<Button full icon={FolderOpenIcon} onclick={() => report(home.openFromDisk())}>
					Open file...
				</Button>
			</div>
			{#each SECTIONS as link (link.id)}
				{@const Icon = link.icon}
				<button
					type="button"
					class="hover:bg-hover flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
					class:bg-raised={home.section === link.id}
					aria-current={home.section === link.id}
					onclick={() => home.setSection(link.id)}
				>
					<Icon size={14} />
					<span class="flex-1">{link.label}</span>
					<span class="text-faint">{home.countIn(link.id)}</span>
				</button>
			{/each}
		</nav>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="border-line-faint flex h-14 shrink-0 items-center gap-3 border-b px-6">
				<h1 class="text-sm font-semibold">{sectionLabel}</h1>
				<div class="flex-1"></div>
				<label class="bg-input border-line flex h-7 w-56 items-center gap-1.5 rounded border px-2">
					<MagnifyingGlassIcon size={12} class="text-faint" />
					<input
						class="text-default w-full bg-transparent text-xs outline-none"
						placeholder="Search by name"
						aria-label="Search files"
						value={home.query}
						oninput={(event) => home.setQuery(event.currentTarget.value)}
					/>
				</label>
				<div class="w-36">
					<Select
						size="sm"
						value={home.sort}
						options={SORTS}
						onChange={(next) => {
							if (next === 'recent' || next === 'name') home.setSort(next);
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
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto p-6">
				{#if entries.length === 0}
					<div
						class="text-muted flex h-full flex-col items-center justify-center gap-3 text-sm"
						data-home-empty
					>
						<p>{emptyMessage()}</p>
						{#if home.query.trim() === ''}
							<Button variant="primary" icon={PlusIcon} onclick={() => report(home.newFile())}>
								New design file
							</Button>
						{/if}
					</div>
				{:else if home.view === 'grid'}
					<ul class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4" data-home-grid>
						{#each entries as entry (entry.path)}
							<li class="group relative" data-home-entry={entry.path}>
								<button
									type="button"
									class="hover:border-line-strong border-line-faint bg-elevated block w-full overflow-hidden rounded-lg border text-left"
									onclick={() => report(home.open(entry))}
								>
									<div class="bg-input aspect-[16/10] w-full">
										<Thumbnail thumbnail={entry.thumbnail} name={entry.name} />
									</div>
									<div class="px-3 py-2">
										<div class="truncate text-xs font-medium">{entry.name}</div>
										<div class="text-faint truncate text-xs">{subtitle(entry)}</div>
									</div>
								</button>
								<div
									class="absolute top-2 right-2 hidden gap-1 group-focus-within:flex group-hover:flex"
								>
									<button
										type="button"
										class="bg-elevated border-line text-muted hover:text-default rounded border px-1.5 py-0.5 text-xs"
										aria-label="Show {entry.name} in folder"
										onclick={() => report(home.reveal(entry))}
									>
										Show in folder
									</button>
									{#if entry.kind === 'recent'}
										<button
											type="button"
											class="bg-elevated border-line text-muted hover:text-default inline-flex items-center rounded border px-1"
											aria-label="Remove {entry.name} from recents"
											onclick={() => report(home.removeRecent(entry))}
										>
											<XIcon size={10} weight="bold" />
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<ul class="flex flex-col" data-home-list>
						{#each entries as entry (entry.path)}
							<li
								class="group border-line-faint hover:bg-hover flex items-center gap-3 border-b px-2 py-2"
								data-home-entry={entry.path}
							>
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-3 text-left"
									onclick={() => report(home.open(entry))}
								>
									<div
										class="bg-input border-line-faint h-10 w-16 shrink-0 overflow-hidden rounded border"
									>
										<Thumbnail thumbnail={entry.thumbnail} name={entry.name} />
									</div>
									<div class="min-w-0">
										<div class="truncate text-xs font-medium">{entry.name}</div>
										<div class="text-faint truncate text-xs">{entry.path}</div>
									</div>
								</button>
								<span class="text-faint shrink-0 text-xs">{subtitle(entry)}</span>
								<button
									type="button"
									class="text-muted hover:text-default shrink-0 text-xs"
									aria-label="Show {entry.name} in folder"
									onclick={() => report(home.reveal(entry))}
								>
									Show in folder
								</button>
								{#if entry.kind === 'recent'}
									<button
										type="button"
										class="text-muted hover:text-default shrink-0"
										aria-label="Remove {entry.name} from recents"
										onclick={() => report(home.removeRecent(entry))}
									>
										<XIcon size={12} weight="bold" />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}
