<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import { filterFamilies } from './typography';

	let {
		families,
		value,
		mixed = false,
		missing = false,
		onchange
	}: {
		families: string[];
		value: string | null;
		mixed?: boolean;
		/** The referenced face is not installed: the label is flagged. */
		missing?: boolean;
		onchange: (family: string) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');

	const matches = $derived(filterFamilies(families, query));
	const label = $derived.by(() => {
		if (mixed) return 'Mixed';
		if (value === null) return 'Font';
		return value;
	});

	function choose(family: string): void {
		onchange(family);
		open = false;
		query = '';
	}

	function onsearchkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			open = false;
			query = '';
			return;
		}
		if (event.key !== 'Enter' || matches.length === 0) return;
		choose(matches[0]);
	}
</script>

<div class="relative" data-font-family-picker>
	<button
		type="button"
		aria-label="Font family"
		aria-expanded={open}
		title={missing ? `${label} is not installed: a substitute is shown` : 'Font family'}
		class="bg-input border-line text-default hover:bg-hover flex h-7 w-full items-center gap-1.5 rounded-md border px-2 text-xs"
		onclick={() => (open = !open)}
	>
		<span class="min-w-0 flex-1 truncate text-left">{label}</span>
		{#if missing}
			<span class="text-red flex shrink-0" data-missing-font><WarningIcon size={13} /></span>
		{/if}
		<CaretDownIcon size={11} class="text-muted shrink-0" />
	</button>
	{#if open}
		<div
			class="bg-elevated border-line absolute inset-x-0 top-8 z-20 flex max-h-64 flex-col rounded-md border shadow-lg"
		>
			<input
				type="text"
				aria-label="Search fonts"
				placeholder="Search fonts"
				class="border-line text-default placeholder:text-faint h-7 shrink-0 border-b bg-transparent px-2 text-xs outline-none"
				bind:value={query}
				onkeydown={onsearchkeydown}
			/>
			<ul role="listbox" aria-label="Fonts" class="min-h-0 flex-1 overflow-y-auto py-1">
				{#each matches as family (family)}
					<li role="option" aria-selected={family === value}>
						<button
							type="button"
							class={[
								'hover:bg-hover w-full truncate px-2 py-1 text-left text-xs',
								family === value ? 'text-default' : 'text-muted'
							]}
							onclick={() => choose(family)}
						>
							{family}
						</button>
					</li>
				{:else}
					<li class="text-faint px-2 py-1 text-xs">No fonts match</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
