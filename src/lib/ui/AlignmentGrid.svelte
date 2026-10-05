<script lang="ts">
	type Index = 0 | 1 | 2;

	let {
		name,
		column,
		row,
		disabled = false,
		onchange
	}: {
		/** Accessible name of the grid. */
		name: string;
		/** Highlighted column; `null` highlights every column (for example space between). */
		column: Index | null;
		/** Highlighted row; `null` highlights every row. */
		row: Index | null;
		disabled?: boolean;
		onchange: (cell: { column: Index; row: Index }) => void;
	} = $props();

	const INDEXES: Index[] = [0, 1, 2];
	const VERTICAL = ['top', 'center', 'bottom'];
	const HORIZONTAL = ['left', 'center', 'right'];

	function cellName(cellColumn: Index, cellRow: Index): string {
		if (cellColumn === 1 && cellRow === 1) return 'Align center';
		return `Align ${VERTICAL[cellRow]} ${HORIZONTAL[cellColumn]}`;
	}

	function active(cellColumn: Index, cellRow: Index): boolean {
		if (column !== null && column !== cellColumn) return false;
		if (row !== null && row !== cellRow) return false;
		return true;
	}
</script>

<!-- A 3 x 3 grid of alignment targets: the dot of the chosen cell is filled. -->
<div
	role="group"
	aria-label={name}
	data-alignment-grid={name}
	class="bg-input border-line grid size-14 shrink-0 grid-cols-3 grid-rows-3 rounded-md border p-0.5"
>
	{#each INDEXES as cellRow (cellRow)}
		{#each INDEXES as cellColumn (cellColumn)}
			{@const chosen = active(cellColumn, cellRow)}
			<button
				type="button"
				aria-label={cellName(cellColumn, cellRow)}
				aria-pressed={chosen}
				{disabled}
				class="hover:bg-hover group flex items-center justify-center rounded transition-colors disabled:opacity-40"
				onclick={() => onchange({ column: cellColumn, row: cellRow })}
			>
				<span
					class={[
						'rounded-full transition-all',
						chosen ? 'bg-default size-1.5' : 'bg-faint group-hover:bg-muted size-1'
					]}
				></span>
			</button>
		{/each}
	{/each}
</div>
