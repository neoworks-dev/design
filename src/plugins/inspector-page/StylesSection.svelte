<script lang="ts">
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import type { StyleType } from '../../lib/document';
	import StylePreview from '../../lib/inspector-inputs/StylePreview.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import { groupByPath, leafNameOf } from '../../lib/variables/organize';

	const ctx = getKernel();

	const TYPE_LABELS: Record<StyleType, string> = {
		PAINT: 'Color',
		TEXT: 'Text',
		EFFECT: 'Effect',
		GRID: 'Grid'
	};

	const groups = $derived(groupByPath(ctx.styles.list()));
	let error = $state('');

	function rename(styleId: string, name: string): void {
		const trimmed = name.trim();
		if (trimmed === '') return;
		try {
			ctx.styles.rename(styleId, trimmed);
			error = '';
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
		}
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-styles-section>
	{#each groups as group (group.path)}
		{#if group.path !== ''}
			<div class="text-faint pt-1 text-xs" data-style-group={group.path}>{group.path}</div>
		{/if}
		{#each group.items as style (style.id)}
			<div class="group flex items-center gap-2 text-xs" data-style-row={style.id}>
				<StylePreview {style} />
				<input
					class="text-default hover:border-line focus:border-action min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5"
					aria-label="Style name {style.name}"
					value={style.name}
					title={leafNameOf(style.name)}
					onchange={(event) => rename(style.id, event.currentTarget.value)}
				/>
				<span class="text-faint">{TYPE_LABELS[style.type]}</span>
				<button
					type="button"
					class="text-muted hover:text-default hidden group-hover:block"
					aria-label="Delete style {style.name}"
					title="Delete style (consumers keep their values)"
					onclick={() => ctx.styles.remove(style.id)}
				>
					<TrashIcon size={12} />
				</button>
			</div>
		{/each}
	{:else}
		<p class="text-faint text-xs">No local styles</p>
	{/each}
	{#if error !== ''}
		<p class="text-red text-xs" role="alert">{error}</p>
	{/if}
</div>
