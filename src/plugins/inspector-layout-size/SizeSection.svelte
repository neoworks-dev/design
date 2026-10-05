<script lang="ts">
	import { Checkbox } from '@neoworks-dev/ui';
	import LinkSimpleHorizontalBreakIcon from 'phosphor-svelte/lib/LinkSimpleHorizontalBreakIcon';
	import LinkSimpleHorizontalIcon from 'phosphor-svelte/lib/LinkSimpleHorizontalIcon';
	import type { Node } from '../../lib/document';
	import { planResizeTo } from '../../lib/inspector-inputs/geometry';
	import {
		boundVariableName,
		editSelection,
		selectedNodes,
		setSelectionProps
	} from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import {
		CONSTRAINT_OPTIONS,
		hugAllowed,
		fillAllowed,
		isAutoLayoutFrame,
		isLayoutChild,
		isConstrainable,
		type Axis,
		type LimitProperty
	} from './sizing';

	const ctx = getKernel();

	const nodes = $derived(selectedNodes(ctx));

	function sizeOf(node: Node, axis: 'width' | 'height'): number {
		if (!('width' in node)) return 0;
		return node[axis];
	}

	const width = $derived(sharedValue(nodes, (node) => sizeOf(node, 'width')));
	const height = $derived(sharedValue(nodes, (node) => sizeOf(node, 'height')));
	const widthVariable = $derived(boundVariableName(ctx, nodes, 'width'));
	const heightVariable = $derived(boundVariableName(ctx, nodes, 'height'));
	const proportions = $derived(
		sharedValue(nodes, (node) => 'constrainProportions' in node && node.constrainProportions)
	);

	function resizeTo(axis: 'width' | 'height', value: number, gesture: NumberGesture): void {
		editSelection(
			ctx,
			{ label: 'Resize', mergeKey: `inspector:${axis}`, gesture },
			(reader, node) => planResizeTo(reader, node.id, { [axis]: value })
		);
	}

	function toggleProportions(): void {
		const next = !(proportions.value === true);
		setSelectionProps(
			ctx,
			{ label: 'Lock proportions', mergeKey: 'inspector:proportions', gesture: 'commit' },
			(node) => {
				if (!('constrainProportions' in node)) return {};
				return { constrainProportions: next };
			}
		);
	}

	// ---------- resizing: fixed, hug, fill ----------

	function sizingKey(axis: Axis): 'layoutSizingHorizontal' | 'layoutSizingVertical' {
		if (axis === 'horizontal') return 'layoutSizingHorizontal';
		return 'layoutSizingVertical';
	}

	function sizingOf(node: Node, axis: Axis): string {
		if (!('layoutSizingHorizontal' in node)) return 'FIXED';
		return node[sizingKey(axis)];
	}

	const canHug = $derived(nodes.every((node) => hugAllowed(node)));
	const canFill = $derived(nodes.every((node) => fillAllowed(ctx.document.reader, node)));
	const showSizing = $derived(
		nodes.some((node) => hugAllowed(node) || fillAllowed(ctx.document.reader, node)) ||
			nodes.some((node) => sizingOf(node, 'horizontal') !== 'FIXED')
	);

	function sizingOptions(): Array<{
		value: string;
		label: string;
		disabled?: boolean;
		title?: string;
	}> {
		return [
			{ value: 'FIXED', label: 'Fixed' },
			{
				value: 'HUG',
				label: 'Hug',
				disabled: !canHug,
				title: canHug ? 'Hug contents' : 'Hug needs an auto layout frame or text'
			},
			{
				value: 'FILL',
				label: 'Fill',
				disabled: !canFill,
				title: canFill ? 'Fill container' : 'Fill needs an auto layout parent'
			}
		];
	}

	function setSizing(axis: Axis, value: string): void {
		setSelectionProps(
			ctx,
			{ label: 'Change resizing', mergeKey: `inspector:sizing-${axis}`, gesture: 'commit' },
			(node) => {
				if (!('layoutSizingHorizontal' in node)) return {};
				return { [sizingKey(axis)]: value };
			}
		);
	}

	// ---------- min and max ----------

	const showLimits = $derived(
		nodes.some((node) => isAutoLayoutFrame(node) || isLayoutChild(ctx.document.reader, node))
	);

	const LIMITS: Array<{ property: LimitProperty; label: string; name: string }> = [
		{ property: 'minWidth', label: 'Min W', name: 'Minimum width' },
		{ property: 'maxWidth', label: 'Max W', name: 'Maximum width' },
		{ property: 'minHeight', label: 'Min H', name: 'Minimum height' },
		{ property: 'maxHeight', label: 'Max H', name: 'Maximum height' }
	];

	function limitOf(node: Node, property: LimitProperty): number | null {
		if (!('minWidth' in node)) return null;
		return node[property];
	}

	function setLimit(property: LimitProperty, value: number | null, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change size limit', mergeKey: `inspector:${property}`, gesture },
			(node) => {
				if (!('minWidth' in node)) return {};
				return { [property]: value };
			}
		);
	}

	// ---------- clip content ----------

	const clipping = $derived(
		sharedValue(nodes, (node) => 'clipsContent' in node && node.clipsContent)
	);
	const showClip = $derived(nodes.length > 0 && nodes.every((node) => 'clipsContent' in node));

	function setClip(checked: boolean): void {
		setSelectionProps(
			ctx,
			{ label: 'Clip content', mergeKey: 'inspector:clip', gesture: 'commit' },
			(node) => {
				if (!('clipsContent' in node)) return {};
				return { clipsContent: checked };
			}
		);
	}

	// ---------- constraints ----------

	const showConstraints = $derived(
		nodes.length > 0 && nodes.every((node) => isConstrainable(ctx.document.reader, node))
	);

	function constraintOf(node: Node, axis: Axis): string {
		if (!('constraints' in node)) return 'MIN';
		return node.constraints[axis];
	}

	function setConstraint(axis: Axis, value: string): void {
		setSelectionProps(
			ctx,
			{ label: 'Change constraints', mergeKey: `inspector:constraint-${axis}`, gesture: 'commit' },
			(node) => {
				if (!('constraints' in node)) return {};
				return { constraints: { ...node.constraints, [axis]: value } };
			}
		);
	}
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-size-section>
	<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
		<NumberField
			label="W"
			name="Width"
			min={0.01}
			value={width.value}
			mixed={width.mixed}
			boundTo={widthVariable}
			disabled={widthVariable !== undefined}
			onchange={(value, gesture) => resizeTo('width', value, gesture)}
		/>
		<IconToggleButton
			icon={proportions.value === true ? LinkSimpleHorizontalIcon : LinkSimpleHorizontalBreakIcon}
			label="Constrain proportions"
			pressed={proportions.value === true}
			onclick={toggleProportions}
		/>
		<NumberField
			label="H"
			name="Height"
			min={0.01}
			value={height.value}
			mixed={height.mixed}
			boundTo={heightVariable}
			disabled={heightVariable !== undefined}
			onchange={(value, gesture) => resizeTo('height', value, gesture)}
		/>
	</div>

	{#if showSizing}
		<div class="grid grid-cols-2 gap-2" data-resizing-row>
			{#each ['horizontal', 'vertical'] as const as axis (axis)}
				{@const shared = sharedValue(nodes, (node) => sizingOf(node, axis))}
				<ToggleGroup
					name={axis === 'horizontal' ? 'Horizontal resizing' : 'Vertical resizing'}
					options={sizingOptions()}
					value={shared.value}
					mixed={shared.mixed}
					onchange={(value) => setSizing(axis, value)}
				/>
			{/each}
		</div>
	{/if}

	{#if showLimits}
		<div class="grid grid-cols-2 gap-2" data-limits>
			{#each LIMITS as limit (limit.property)}
				{@const shared = sharedValue(nodes, (node) => limitOf(node, limit.property))}
				<NumberField
					label={limit.label}
					name={limit.name}
					min={0}
					value={shared.value}
					mixed={shared.mixed}
					placeholder="None"
					onclear={() => setLimit(limit.property, null, 'commit')}
					onchange={(value, gesture) => setLimit(limit.property, value, gesture)}
				/>
			{/each}
		</div>
	{/if}

	{#if showConstraints}
		<div class="grid grid-cols-2 gap-2" data-constraints>
			{#each ['horizontal', 'vertical'] as const as axis (axis)}
				{@const shared = sharedValue(nodes, (node) => constraintOf(node, axis))}
				<DropdownField
					options={CONSTRAINT_OPTIONS[axis]}
					value={shared.value}
					mixed={shared.mixed}
					onchange={(value) => setConstraint(axis, value)}
				/>
			{/each}
		</div>
	{/if}

	{#if showClip}
		<label class="text-default flex items-center gap-2 text-xs" data-clip-content>
			<Checkbox
				size="sm"
				checked={clipping.value === true}
				aria-label="Clip content"
				onchange={(event: Event) => {
					if (event.currentTarget instanceof HTMLInputElement) setClip(event.currentTarget.checked);
				}}
			/>
			Clip content
			{#if clipping.mixed}<span class="text-muted">(Mixed)</span>{/if}
		</label>
	{/if}
</div>
