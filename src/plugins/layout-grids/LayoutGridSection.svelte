<script lang="ts">
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import type { LayoutGrid } from '../../lib/document';
	import { selectedNodes, setSelectionProps } from '../../lib/inspector-inputs/selectionEdit';
	import { cssColor } from '../../lib/layout-grids/draw';
	import { defaultGrid } from '../../lib/layout-grids/grids';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const ctx = getKernel();

	const PATTERNS = [
		{ value: 'COLUMNS', label: 'Columns' },
		{ value: 'ROWS', label: 'Rows' },
		{ value: 'GRID', label: 'Grid' }
	];

	const frame = $derived.by(() => {
		const [first] = selectedNodes(ctx);
		if (first === undefined || !('layoutGrids' in first)) return undefined;
		return first;
	});
	const grids = $derived.by((): LayoutGrid[] => {
		if (frame === undefined || !('layoutGrids' in frame)) return [];
		return frame.layoutGrids;
	});

	function alignmentOptions(grid: LayoutGrid): { value: string; label: string }[] {
		const columns = grid.pattern === 'COLUMNS';
		return [
			{ value: 'STRETCH', label: 'Stretch' },
			{ value: 'MIN', label: columns ? 'Left' : 'Top' },
			{ value: 'CENTER', label: 'Center' },
			{ value: 'MAX', label: columns ? 'Right' : 'Bottom' }
		];
	}

	function write(
		change: (current: LayoutGrid[]) => LayoutGrid[],
		label: string,
		gesture: NumberGesture = 'commit'
	): void {
		setSelectionProps(
			ctx,
			{ label, mergeKey: `inspector:layout-grid:${label}`, gesture },
			(node) => {
				if (!('layoutGrids' in node)) return {};
				return { layoutGrids: change(node.layoutGrids) };
			}
		);
	}

	function update(
		index: number,
		patch: Partial<LayoutGrid>,
		label: string,
		gesture: NumberGesture = 'commit'
	): void {
		write(
			(current) =>
				current.map((grid, position) => (position === index ? { ...grid, ...patch } : grid)),
			label,
			gesture
		);
	}

	function remove(index: number): void {
		write((current) => current.filter((_, position) => position !== index), 'Remove layout grid');
	}

	function setPattern(index: number, pattern: string): void {
		if (pattern !== 'COLUMNS' && pattern !== 'ROWS' && pattern !== 'GRID') return;
		const current = grids[index];
		if (current === undefined) return;
		const replacement = { ...defaultGrid(pattern), visible: current.visible, color: current.color };
		write(
			(list) => list.map((grid, position) => (position === index ? replacement : grid)),
			'Change grid type'
		);
	}

	function setAlignment(index: number, alignment: string): void {
		if (!['MIN', 'MAX', 'CENTER', 'STRETCH'].includes(alignment)) return;
		update(index, { alignment: alignment as LayoutGrid['alignment'] }, 'Change grid alignment');
	}

	function openColor(event: MouseEvent, index: number): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		ctx.colorPicker.open({
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
			label: 'Grid color',
			scope: 'FILL',
			color: () => {
				const grid = grids[index];
				if (grid === undefined) return { r: 1, g: 0, b: 0, a: 0.1 };
				return grid.color;
			},
			onchange: (color, gesture) => update(index, { color }, 'Change grid color', gesture)
		});
	}

	function field(
		index: number,
		key: 'count' | 'gutterSize' | 'offset' | 'sectionSize',
		label: string
	): (value: number, gesture: NumberGesture) => void {
		return (value, gesture) => update(index, { [key]: value }, label, gesture);
	}

	function stretches(grid: LayoutGrid): boolean {
		return grid.alignment === undefined || grid.alignment === 'STRETCH';
	}
</script>

{#if frame !== undefined}
	<div class="flex flex-col gap-2 px-4 pb-4" data-layout-grid-section>
		{#each grids as grid, index (index)}
			<div class="flex flex-col gap-1" data-layout-grid={index}>
				<div class="flex items-center gap-1">
					<div class="min-w-0 flex-1">
						<DropdownField
							options={PATTERNS}
							value={grid.pattern}
							onchange={(pattern) => setPattern(index, pattern)}
						/>
					</div>
					<IconToggleButton
						icon={grid.visible ? EyeIcon : EyeSlashIcon}
						label="Toggle grid {index + 1} visibility"
						pressed={grid.visible}
						onclick={() => update(index, { visible: !grid.visible }, 'Toggle layout grid')}
					/>
					<IconToggleButton
						icon={MinusIcon}
						label="Remove grid {index + 1}"
						onclick={() => remove(index)}
					/>
				</div>
				<div class="grid grid-cols-2 gap-1">
					{#if grid.pattern === 'GRID'}
						<NumberField
							label="#"
							name="Grid size"
							min={1}
							value={grid.sectionSize === undefined ? 10 : grid.sectionSize}
							onchange={field(index, 'sectionSize', 'Change grid size')}
						/>
					{:else}
						<NumberField
							label="#"
							name="Grid count"
							min={1}
							precision={0}
							value={grid.count === undefined ? 5 : grid.count}
							onchange={field(index, 'count', 'Change grid count')}
						/>
						<DropdownField
							options={alignmentOptions(grid)}
							value={grid.alignment === undefined ? 'STRETCH' : grid.alignment}
							onchange={(alignment) => setAlignment(index, alignment)}
						/>
						{#if !stretches(grid)}
							<NumberField
								label="W"
								name="Grid width"
								min={1}
								value={grid.sectionSize === undefined ? 64 : grid.sectionSize}
								onchange={field(index, 'sectionSize', 'Change grid width')}
							/>
						{/if}
						<NumberField
							label="M"
							name="Grid margin"
							value={grid.offset === undefined ? 0 : grid.offset}
							onchange={field(index, 'offset', 'Change grid margin')}
						/>
						<NumberField
							label="G"
							name="Grid gutter"
							min={0}
							value={grid.gutterSize === undefined ? 20 : grid.gutterSize}
							onchange={field(index, 'gutterSize', 'Change grid gutter')}
						/>
					{/if}
					<button
						type="button"
						aria-label="Grid {index + 1} color"
						class="border-line h-8 cursor-pointer rounded-md border"
						style:background={cssColor(grid.color)}
						onclick={(event) => openColor(event, index)}
					></button>
				</div>
			</div>
		{/each}
	</div>
{/if}
