<script lang="ts">
	import { planSetProps, type Change, type Node, type RGB } from '../../lib/document';
	import { applyEdit } from '../../lib/editing/contribute';
	import { getKernel } from '../../lib/kernel/context';
	import { colorToHex } from '../../lib/ui/color';
	import { collectColors, planColorReplacement, type ColorRow } from './colors';

	const ctx = getKernel();

	function subtreeIds(): string[] {
		const ids: string[] = [];
		for (const id of ctx.selection.ids) {
			if (!ctx.document.has(id)) continue;
			ids.push(id, ...ctx.document.descendants(id).map((node) => node.id));
		}
		return ids;
	}

	const resolvedNodes = $derived(subtreeIds().map((id) => ctx.variables.resolvedNode(id)));
	const rows = $derived(collectColors(resolvedNodes));

	function nameOf(row: ColorRow): string | undefined {
		if (row.variableId !== undefined) {
			const variable = ctx.variables.variable(row.variableId);
			if (variable === undefined) return row.variableId;
			return variable.name;
		}
		if (row.styleId === undefined) return undefined;
		const style = ctx.document.reader.document.styles[row.styleId];
		if (style === undefined) return row.styleId;
		return style.name;
	}

	function label(row: ColorRow): string {
		const name = nameOf(row);
		if (name === undefined) return colorToHex(row.color);
		return name;
	}

	function openPicker(event: MouseEvent, index: number): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		ctx.colorPicker.open({
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
			label: 'Replace color',
			scope: 'FILL',
			color: () => {
				const row = rows[index];
				if (row === undefined) return { r: 0, g: 0, b: 0, a: 1 };
				return { ...row.color, a: 1 };
			},
			onchange: (color) => {
				const row = rows[index];
				if (row === undefined) return;
				replace(row, index, { r: color.r, g: color.g, b: color.b });
			}
		});
	}

	function replace(row: ColorRow, index: number, color: RGB): void {
		const reader = ctx.document.reader;
		const nodes: Node[] = subtreeIds().map((id) => reader.requireNode(id));
		const changes: Change[] = [];
		for (const [id, props] of planColorReplacement(nodes, row.key, color)) {
			changes.push(...planSetProps(reader, id, props));
		}
		applyEdit(ctx, changes, 'Replace color', `inspector:selection-color:${index}`);
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-selection-colors>
	{#each rows as row, index (index)}
		<div
			class="border-line bg-raised flex h-7 items-center gap-1.5 rounded-md border px-1.5"
			data-color-row={row.key}
		>
			<button
				type="button"
				aria-label={`Replace ${label(row)}`}
				class="border-line size-4 shrink-0 cursor-pointer rounded-sm border"
				style:background={colorToHex(row.color)}
				data-color-swatch={row.key}
				onclick={(event) => openPicker(event, index)}
			></button>
			<span class="text-default min-w-0 flex-1 truncate text-xs uppercase tabular-nums">
				{label(row)}
			</span>
			<span class="bg-line h-3.5 w-px shrink-0"></span>
			<span class="text-faint w-5 text-right text-xs tabular-nums" title="Usages">{row.count}</span>
		</div>
	{:else}
		<p class="text-faint text-xs">No solid colors in the selection</p>
	{/each}
</div>
