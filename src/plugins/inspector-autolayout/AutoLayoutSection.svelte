<script lang="ts">
	import { Checkbox } from '@neoworks-dev/ui';
	import ArrowBendDownLeftIcon from 'phosphor-svelte/lib/ArrowBendDownLeftIcon';
	import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowsHorizontalIcon from 'phosphor-svelte/lib/ArrowsHorizontalIcon';
	import ArrowsOutCardinalIcon from 'phosphor-svelte/lib/ArrowsOutCardinalIcon';
	import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import type { Node } from '../../lib/document';
	import {
		boundVariableName,
		editSelection,
		selectedNodes,
		setSelectionProps
	} from '../../lib/inspector-inputs/selectionEdit';
	import BindVariable from '../../lib/inspector-inputs/BindVariable.svelte';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import { isStackContainer } from '../../lib/layout/build';
	import {
		alignmentProps,
		cellOf,
		flowOf,
		HORIZONTAL_PADDING,
		paddingKey,
		planSetFlow,
		VERTICAL_PADDING,
		type Flow,
		type PaddingSide
	} from '../../lib/layout/flow';
	import AlignmentGrid from '../../lib/ui/AlignmentGrid.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';

	const ctx = getKernel();

	const nodes = $derived(selectedNodes(ctx));
	const canHaveLayout = $derived(nodes.length > 0 && nodes.every((node) => 'layoutMode' in node));
	const hasLayout = $derived(canHaveLayout && nodes.every((node) => isStackContainer(node)));
	const inStack = $derived(
		nodes.length > 0 &&
			nodes.every((node) => {
				if (node.parentId === null) return false;
				return isStackContainer(ctx.document.require(node.parentId));
			})
	);

	// ---------- flow ----------

	const FLOW_OPTIONS = [
		{ value: 'NONE', label: 'Freeform', icon: ArrowsOutCardinalIcon },
		{ value: 'VERTICAL', label: 'Vertical', icon: ArrowDownIcon },
		{ value: 'HORIZONTAL', label: 'Horizontal', icon: ArrowRightIcon },
		{ value: 'WRAP', label: 'Wrap', icon: ArrowBendDownLeftIcon }
	];

	function shownFlow(node: Node): Flow | null {
		const result = flowOf(node);
		if (result === undefined) return null;
		return result;
	}

	const flow = $derived(sharedValue(nodes, shownFlow));

	function setFlow(value: string): void {
		const chosen = value as Flow;
		editSelection(
			ctx,
			{ label: 'Change flow', mergeKey: 'inspector:flow', gesture: 'commit' },
			(reader, node) => planSetFlow(reader, node, chosen)
		);
	}

	// ---------- reading a property of the stacks in the selection ----------

	function layoutOf(node: Node): Extract<Node, { layoutMode: string }> | undefined {
		if (!isStackContainer(node)) return undefined;
		return node;
	}

	function numberOf(node: Node, key: string): number {
		const value: unknown = Reflect.get(node, key);
		if (typeof value !== 'number') return 0;
		return value;
	}

	const wrapping = $derived(nodes.every((node) => layoutOf(node)?.layoutWrap === 'WRAP'));

	// ---------- alignment grid ----------

	const cell = $derived(
		sharedValue(nodes, (node) => {
			const stack = layoutOf(node);
			if (stack === undefined || stack.layoutMode === 'GRID' || stack.layoutMode === 'NONE') {
				return { column: null, row: null };
			}
			return cellOf(stack.layoutMode, stack.primaryAxisAlignItems, stack.counterAxisAlignItems);
		})
	);

	function alignTo(target: { column: 0 | 1 | 2; row: 0 | 1 | 2 }): void {
		setSelectionProps(
			ctx,
			{ label: 'Change alignment', mergeKey: 'inspector:alignment', gesture: 'commit' },
			(node) => {
				const stack = layoutOf(node);
				if (stack === undefined || stack.layoutMode === 'GRID' || stack.layoutMode === 'NONE') {
					return {};
				}
				return alignmentProps(stack.layoutMode, stack.primaryAxisAlignItems, target);
			}
		);
	}

	// ---------- spacing ----------

	const spacing = $derived(sharedValue(nodes, (node) => numberOf(node, 'itemSpacing')));
	const spaceBetween = $derived(
		nodes.every((node) => layoutOf(node)?.primaryAxisAlignItems === 'SPACE_BETWEEN')
	);
	const lineSpacing = $derived(
		sharedValue(nodes, (node) => {
			const value = layoutOf(node)?.counterAxisSpacing;
			if (value === undefined) return null;
			return value;
		})
	);

	function setSpacing(value: number, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change spacing', mergeKey: 'inspector:spacing', gesture },
			(node) => {
				const props: Record<string, unknown> = { itemSpacing: value };
				if (layoutOf(node)?.primaryAxisAlignItems === 'SPACE_BETWEEN') {
					props.primaryAxisAlignItems = 'MIN';
				}
				return props;
			}
		);
	}

	function toggleAutoSpacing(): void {
		const next = !spaceBetween;
		setSelectionProps(
			ctx,
			{ label: 'Change spacing', mergeKey: 'inspector:auto-spacing', gesture: 'commit' },
			() => ({ primaryAxisAlignItems: next ? 'SPACE_BETWEEN' : 'MIN' })
		);
	}

	function setLineSpacing(value: number | null, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change row spacing', mergeKey: 'inspector:line-spacing', gesture },
			() => ({ counterAxisSpacing: value })
		);
	}

	// ---------- padding ----------

	function padding(side: PaddingSide): ReturnType<typeof sharedValue<Node, number>> {
		return sharedValue(nodes, (node) => numberOf(node, paddingKey(side)));
	}

	/** One value for a pair of sides; mixed when the sides or the nodes disagree. */
	function pairValue(sides: PaddingSide[]): { value: number | null; mixed: boolean } {
		const values = sides.map((side) => padding(side));
		if (values.some((entry) => entry.mixed)) return { value: null, mixed: true };
		if (values[0].value !== values[1].value) return { value: null, mixed: true };
		return values[0];
	}

	function setPadding(sides: PaddingSide[], value: number, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{
				label: 'Change padding',
				mergeKey: `inspector:padding-${sides.join('-')}`,
				gesture
			},
			() => Object.fromEntries(sides.map((side) => [paddingKey(side), value]))
		);
	}

	const symmetric = $derived(
		!pairValue(HORIZONTAL_PADDING).mixed && !pairValue(VERTICAL_PADDING).mixed
	);
	let expandedByUser = $state(false);
	const perSide = $derived(expandedByUser || !symmetric);

	const SIDES: Array<{ side: PaddingSide; label: string }> = [
		{ side: 'Top', label: 'T' },
		{ side: 'Right', label: 'R' },
		{ side: 'Bottom', label: 'B' },
		{ side: 'Left', label: 'L' }
	];

	// ---------- strokes, absolute position ----------

	const strokesIncluded = $derived(
		sharedValue(nodes, (node) => layoutOf(node)?.strokesIncludedInLayout === true)
	);

	function setStrokesIncluded(checked: boolean): void {
		setSelectionProps(
			ctx,
			{ label: 'Strokes in layout', mergeKey: 'inspector:strokes-in-layout', gesture: 'commit' },
			() => ({ strokesIncludedInLayout: checked })
		);
	}

	const absolute = $derived(
		nodes.length > 0 &&
			nodes.every((node) => 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE')
	);

	function toggleAbsolute(): void {
		const next = absolute ? 'AUTO' : 'ABSOLUTE';
		setSelectionProps(
			ctx,
			{ label: 'Absolute position', mergeKey: 'inspector:absolute', gesture: 'commit' },
			(node) => {
				if (!('layoutPositioning' in node)) return {};
				return { layoutPositioning: next };
			}
		);
	}
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-autolayout-section>
	{#if canHaveLayout}
		<ToggleGroup
			name="Flow"
			options={FLOW_OPTIONS}
			value={flow.value}
			mixed={flow.mixed}
			onchange={setFlow}
		/>
	{/if}

	{#if hasLayout}
		<div class="flex gap-2" data-autolayout-controls>
			<AlignmentGrid
				name="Alignment"
				column={cell.value === null ? null : cell.value.column}
				row={cell.value === null ? null : cell.value.row}
				disabled={cell.mixed}
				onchange={alignTo}
			/>
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<div class="flex items-center gap-1">
					<NumberField
						label="Gap"
						name="Item spacing"
						min={0}
						value={spaceBetween ? null : spacing.value}
						mixed={!spaceBetween && spacing.mixed}
						placeholder="Auto"
						boundTo={boundVariableName(ctx, nodes, 'itemSpacing')}
						onchange={setSpacing}
					>
						{#snippet trailing()}
							<BindVariable {nodes} property="itemSpacing" scopes={['GAP']} label="Gap" />
						{/snippet}
					</NumberField>
					<IconToggleButton
						icon={ArrowsHorizontalIcon}
						label="Auto spacing"
						title="Auto spacing: space between items"
						pressed={spaceBetween}
						onclick={toggleAutoSpacing}
					/>
				</div>
				{#if wrapping}
					<NumberField
						label="Row"
						name="Row spacing"
						min={0}
						value={lineSpacing.value}
						mixed={lineSpacing.mixed}
						placeholder="Same"
						onclear={() => setLineSpacing(null, 'commit')}
						onchange={setLineSpacing}
					/>
				{/if}
			</div>
		</div>

		<div class="flex items-start gap-1" data-padding>
			{#if perSide}
				<div class="grid flex-1 grid-cols-2 gap-1">
					{#each SIDES as entry (entry.side)}
						{@const value = padding(entry.side)}
						<NumberField
							label={entry.label}
							name={`Padding ${entry.side.toLowerCase()}`}
							min={0}
							value={value.value}
							mixed={value.mixed}
							boundTo={boundVariableName(ctx, nodes, `padding${entry.side}`)}
							onchange={(next, gesture) => setPadding([entry.side], next, gesture)}
						>
							{#snippet trailing()}
								<BindVariable
									{nodes}
									property={`padding${entry.side}`}
									scopes={['GAP']}
									label={`Padding ${entry.side.toLowerCase()}`}
								/>
							{/snippet}
						</NumberField>
					{/each}
				</div>
			{:else}
				{@const horizontal = pairValue(HORIZONTAL_PADDING)}
				{@const vertical = pairValue(VERTICAL_PADDING)}
				<div class="grid flex-1 grid-cols-2 gap-1">
					<NumberField
						label="H"
						name="Horizontal padding"
						min={0}
						value={horizontal.value}
						mixed={horizontal.mixed}
						onchange={(next, gesture) => setPadding(HORIZONTAL_PADDING, next, gesture)}
					/>
					<NumberField
						label="V"
						name="Vertical padding"
						min={0}
						value={vertical.value}
						mixed={vertical.mixed}
						onchange={(next, gesture) => setPadding(VERTICAL_PADDING, next, gesture)}
					/>
				</div>
			{/if}
			<IconToggleButton
				icon={SidebarSimpleIcon}
				label="Padding per side"
				pressed={perSide}
				disabled={!symmetric}
				onclick={() => (expandedByUser = !expandedByUser)}
			/>
		</div>

		<label class="text-default flex items-center gap-2 text-xs" data-strokes-included>
			<Checkbox
				size="sm"
				checked={strokesIncluded.value === true}
				aria-label="Strokes included in layout"
				onchange={(event: Event) => {
					if (event.currentTarget instanceof HTMLInputElement) {
						setStrokesIncluded(event.currentTarget.checked);
					}
				}}
			/>
			Include strokes in layout
			{#if strokesIncluded.mixed}<span class="text-muted">(Mixed)</span>{/if}
		</label>
	{/if}

	{#if inStack}
		<div class="flex items-center gap-2 text-xs" data-absolute-position>
			<IconToggleButton
				icon={PushPinIcon}
				label="Absolute position"
				title="Absolute position: ignore the auto layout parent"
				pressed={absolute}
				onclick={toggleAbsolute}
			/>
			<span class="text-muted">Ignore auto layout</span>
		</div>
	{/if}
</div>
