<script lang="ts">
	import { tick } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import { fuzzyMatch } from './fuzzy';

	const ctx = getKernel();
	const palette = ctx.palette;

	const sources = $derived(palette.sourceList());
	const rows = $derived(palette.rows());
	const activeSource = $derived(sources.find((source) => source.id === palette.sourceId));

	let input: HTMLInputElement | undefined = $state();
	let list: HTMLElement | undefined = $state();

	$effect(() => {
		if (palette.isOpen) void tick().then(() => input?.focus());
	});

	$effect(() => {
		const index = palette.index;
		if (!palette.isOpen) return;
		void tick().then(() => {
			list?.querySelector(`[data-palette-row="${index}"]`)?.scrollIntoView({ block: 'nearest' });
		});
	});

	function run(index: number): void {
		const row = rows[index];
		if (!row) return;
		void palette.run(row.item).catch((error: unknown) => ctx.logger.error(error));
	}

	function onkeydown(event: KeyboardEvent): void {
		// The palette owns the keyboard while open: app shortcuts must not fire through it.
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			palette.close();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			palette.move(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			palette.move(-1);
		} else if (event.key === 'Tab') {
			event.preventDefault();
			palette.cycleSource(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			run(palette.index);
		}
	}

	function segments(title: string): { text: string; hit: boolean }[] {
		const indices = new Set(fuzzyMatch(palette.query, title)?.indices);
		const parts: { text: string; hit: boolean }[] = [];
		for (let position = 0; position < title.length; position += 1) {
			const hit = indices.has(position);
			const last = parts[parts.length - 1];
			if (last && last.hit === hit) last.text += title[position];
			else parts.push({ text: title[position], hit });
		}
		return parts;
	}
</script>

{#if palette.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 flex items-start justify-center bg-black/30 pt-[12vh]"
		role="presentation"
		data-palette-backdrop
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) palette.close();
		}}
	>
		<div
			role="dialog"
			aria-label="Command palette"
			class="bg-elevated border-line text-default flex max-h-[60vh] w-[40rem] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-lg"
			data-palette
		>
			{#if sources.length > 1}
				<div
					class="border-line-faint flex gap-1 overflow-x-auto border-b px-2 pt-2 pb-1"
					role="tablist"
				>
					{#each sources as source (source.id)}
						<button
							type="button"
							role="tab"
							aria-selected={source.id === palette.sourceId}
							class={[
								'shrink-0 rounded-md px-2 py-0.5 text-xs whitespace-nowrap',
								source.id === palette.sourceId
									? 'bg-hover text-default'
									: 'text-muted hover:text-default'
							]}
							onclick={() => {
								palette.setSource(source.id);
								input?.focus();
							}}
						>
							{source.title}
						</button>
					{/each}
				</div>
			{/if}
			<input
				bind:this={input}
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls="palette-results"
				aria-label="Search"
				placeholder={activeSource?.placeholder ?? 'Search'}
				class="border-line-faint placeholder:text-faint w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
				value={palette.query}
				oninput={(event) => palette.setQuery(event.currentTarget.value)}
				{onkeydown}
			/>
			<ul
				bind:this={list}
				id="palette-results"
				role="listbox"
				class="min-h-0 flex-1 overflow-y-auto p-1"
			>
				{#each rows as row, position (row.item.id)}
					<li role="none">
						<button
							type="button"
							role="option"
							aria-selected={position === palette.index}
							aria-disabled={row.item.enabled === false ? true : undefined}
							data-palette-row={position}
							class={[
								'flex h-8 w-full items-center gap-3 rounded-md px-3 text-left text-xs',
								position === palette.index && 'bg-hover',
								row.item.enabled === false && 'opacity-40'
							]}
							tabindex="-1"
							onclick={() => run(position)}
							onpointermove={() => {
								palette.highlight(position);
							}}
						>
							<span class="min-w-0 flex-1 truncate">
								{#each segments(row.item.title) as part, partIndex (partIndex)}
									<span class={['', part.hit && 'text-action font-semibold']}>{part.text}</span>
								{/each}
								{#if row.item.subtitle}
									<span class="text-faint pl-2">{row.item.subtitle}</span>
								{/if}
							</span>
							{#if row.item.actionLabel && position === palette.index}
								<span
									class="bg-action text-action-fg shrink-0 rounded-md px-2 py-0.5 font-medium"
									data-palette-action
								>
									{row.item.actionLabel}
								</span>
							{/if}
							{#if row.item.accelerator}
								<span class="text-faint shrink-0" data-palette-accelerator>
									{row.item.accelerator}
								</span>
							{/if}
						</button>
					</li>
				{:else}
					<li class="text-faint px-3 py-6 text-center text-xs" data-palette-empty>No results</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}
