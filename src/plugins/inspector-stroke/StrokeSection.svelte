<script lang="ts">
	import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
	import SquareHalfIcon from 'phosphor-svelte/lib/SquareHalfIcon';
	import {
		geometryKind,
		planSetProps,
		type Node,
		type Paint,
		type Stroke
	} from '../../lib/document';
	import {
		changeFirstStroke,
		changeStrokePaints,
		isPerSide,
		perSideWeights,
		uniformWeight,
		withSideWeight,
		type SideName
	} from '../../lib/editing/strokes';
	import PaintList from '../../lib/inspector-inputs/PaintList.svelte';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import SliderField from '../../lib/ui/SliderField.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import StrokeAdvanced from './StrokeAdvanced.svelte';

	const NO_PAINTS: Paint[] = [];
	const SIDES: Array<{ side: SideName; label: string; name: string }> = [
		{ side: 'top', label: 'T', name: 'Top weight' },
		{ side: 'right', label: 'R', name: 'Right weight' },
		{ side: 'bottom', label: 'B', name: 'Bottom weight' },
		{ side: 'left', label: 'L', name: 'Left weight' }
	];
	const POSITIONS = [
		{ value: 'INSIDE', label: 'Inside' },
		{ value: 'CENTER', label: 'Center' },
		{ value: 'OUTSIDE', label: 'Outside' }
	];

	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function firstStroke(node: Node): Stroke | undefined {
		if (!('strokes' in node)) return undefined;
		return node.strokes[0];
	}
	function paintsOf(node: Node): Paint[] {
		const stroke = firstStroke(node);
		if (stroke === undefined) return NO_PAINTS;
		return stroke.paints;
	}

	const paints = $derived(sharedValue(nodes, paintsOf));
	const shownPaints = $derived.by(() => {
		if (paints.value === null) return [];
		return paints.value;
	});
	const storedPaints = $derived.by(() => {
		const [first] = nodes;
		if (first === undefined) return [];
		return paintsOf(ctx.document.require(first.id));
	});

	const hasStroke = $derived(nodes.length > 0 && nodes.every((node) => firstStroke(node)));
	const weight = $derived(
		sharedValue(nodes, (node) => {
			const stroke = firstStroke(node);
			if (stroke === undefined) return null;
			return stroke.weight;
		})
	);
	const align = $derived(sharedValue(nodes, (node) => firstStroke(node)?.align));
	const canSplitSides = $derived(
		nodes.length > 0 && nodes.every((node) => geometryKind(node) === 'rounded-rect')
	);
	const perSide = $derived(weight.value !== null && isPerSide(weight.value));
	const uniformValue = $derived.by(() => {
		if (weight.value === null) return null;
		return uniformWeight(weight.value);
	});

	let advancedAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function editStrokes(
		label: string,
		gesture: NumberGesture,
		change: (strokes: Stroke[]) => Stroke[]
	): void {
		editSelection(
			ctx,
			{ label, mergeKey: `inspector:stroke:${label}`, gesture },
			(reader, node) => {
				if (!('strokes' in node)) return [];
				return planSetProps(reader, node.id, { strokes: change(node.strokes) });
			}
		);
	}

	function editFirst(
		label: string,
		gesture: NumberGesture,
		change: (stroke: Stroke) => Stroke
	): void {
		editStrokes(label, gesture, (strokes) => changeFirstStroke(strokes, change));
	}

	function editPaints(
		update: (paints: Paint[]) => Paint[],
		gesture: NumberGesture,
		label: string
	): void {
		editStrokes(label, gesture, (strokes) => changeStrokePaints(strokes, update));
	}

	function toggleSides(): void {
		editFirst('Toggle per-side stroke weights', 'commit', (stroke) => {
			if (isPerSide(stroke.weight)) return { ...stroke, weight: uniformWeight(stroke.weight) };
			return { ...stroke, weight: perSideWeights(stroke.weight) };
		});
	}

	function openAdvanced(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		advancedAnchor = { x: box.left, y: box.top, width: box.width, height: box.height };
	}

	function sideValue(side: SideName): number | null {
		if (weight.value === null) return null;
		return perSideWeights(weight.value)[side];
	}
</script>

{#if nodes.length > 0}
	<div data-stroke-section>
		<PaintList
			role="stroke"
			paints={shownPaints}
			stored={storedPaints}
			nodeId={nodes[0].id}
			mixed={paints.mixed}
			onedit={editPaints}
		/>
		{#if hasStroke}
			<div class="flex flex-col gap-2 px-3 pb-3">
				<ToggleGroup
					name="Stroke position"
					options={POSITIONS}
					value={align.value === undefined ? null : align.value}
					mixed={align.mixed}
					onchange={(value) =>
						editFirst('Change stroke position', 'commit', (stroke) => ({
							...stroke,
							align: value as Stroke['align']
						}))}
				/>
				{#if perSide}
					<div class="grid grid-cols-2 gap-2" data-stroke-sides>
						{#each SIDES as entry (entry.side)}
							<NumberField
								label={entry.label}
								name={entry.name}
								min={0}
								value={sideValue(entry.side)}
								onchange={(value, gesture) =>
									editFirst('Change stroke weight', gesture, (stroke) => ({
										...stroke,
										weight: withSideWeight(stroke.weight, entry.side, value)
									}))}
							/>
						{/each}
					</div>
				{:else}
					<SliderField
						label="W"
						name="Stroke weight"
						min={0}
						max={50}
						value={uniformValue}
						mixed={weight.mixed}
						onchange={(value, gesture) =>
							editFirst('Change stroke weight', gesture, (stroke) => ({
								...stroke,
								weight: value
							}))}
					/>
				{/if}
				<div class="flex items-center gap-1">
					{#if canSplitSides}
						<IconToggleButton
							icon={SquareHalfIcon}
							label="Independent stroke weights"
							pressed={perSide}
							onclick={toggleSides}
						/>
					{/if}
					<IconToggleButton
						icon={GearSixIcon}
						label="Advanced stroke settings"
						onclick={openAdvanced}
					/>
				</div>
			</div>
		{/if}
		{#if advancedAnchor !== null}
			<StrokeAdvanced
				anchor={advancedAnchor}
				{nodes}
				onedit={editFirst}
				onclose={() => (advancedAnchor = null)}
			/>
		{/if}
	</div>
{/if}
