<script lang="ts">
	import { Checkbox } from '@neoworks-dev/ui';
	import ArrowLineDownIcon from 'phosphor-svelte/lib/ArrowLineDownIcon';
	import ArrowLineLeftIcon from 'phosphor-svelte/lib/ArrowLineLeftIcon';
	import ArrowLineRightIcon from 'phosphor-svelte/lib/ArrowLineRightIcon';
	import ArrowLineUpIcon from 'phosphor-svelte/lib/ArrowLineUpIcon';
	import ArrowsInLineHorizontalIcon from 'phosphor-svelte/lib/ArrowsInLineHorizontalIcon';
	import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
	import ArrowsOutLineHorizontalIcon from 'phosphor-svelte/lib/ArrowsOutLineHorizontalIcon';
	import ArrowsOutLineVerticalIcon from 'phosphor-svelte/lib/ArrowsOutLineVerticalIcon';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
	import RulerIcon from 'phosphor-svelte/lib/RulerIcon';
	import type { Component } from 'svelte';
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
	import { sharedValue, type InspectorValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import { currentSizing, sizingProps } from '../../lib/layout/sizing';
	import type { Sizing } from '../../lib/layout/types';
	import BindVariable from '../../lib/inspector-inputs/BindVariable.svelte';
	import ConstraintWidget from './ConstraintWidget.svelte';
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

	function sizingFromValue(value: string): Sizing {
		if (value === 'HUG' || value === 'FILL') return value;
		return 'FIXED';
	}

	const canHug = $derived(nodes.every((node) => hugAllowed(node)));
	const canFill = $derived(nodes.every((node) => fillAllowed(ctx.document.reader, node)));
	const showSizing = $derived(
		nodes.some((node) => hugAllowed(node) || fillAllowed(ctx.document.reader, node)) ||
			nodes.some((node) => currentSizing(node, 'horizontal') !== 'FIXED')
	);

	interface SizingOption {
		value: string;
		label: string;
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
	}

	// Modes that cannot apply to the selection are left out instead of shown disabled.
	function sizingOptions(axis: Axis): SizingOption[] {
		const horizontal = axis === 'horizontal';
		const options: SizingOption[] = [{ value: 'FIXED', label: 'Fixed size', icon: RulerIcon }];
		if (canHug) {
			options.push({
				value: 'HUG',
				label: 'Hug contents',
				icon: horizontal ? ArrowsInLineHorizontalIcon : ArrowsInLineVerticalIcon
			});
		}
		if (canFill) {
			options.push({
				value: 'FILL',
				label: 'Fill container',
				icon: horizontal ? ArrowsOutLineHorizontalIcon : ArrowsOutLineVerticalIcon
			});
		}
		return options;
	}

	function setSizing(axis: Axis, value: string): void {
		setSelectionProps(
			ctx,
			{ label: 'Change resizing', mergeKey: `inspector:sizing-${axis}`, gesture: 'commit' },
			(node) => sizingProps(node, axis, sizingFromValue(value))
		);
	}

	// ---------- min and max ----------

	const showLimits = $derived(
		nodes.some((node) => isAutoLayoutFrame(node) || isLayoutChild(ctx.document.reader, node))
	);

	interface LimitDefinition {
		property: LimitProperty;
		label: string;
		name: string;
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
	}

	const LIMITS: LimitDefinition[] = [
		{ property: 'minWidth', label: 'W', name: 'Minimum width', icon: ArrowLineLeftIcon },
		{ property: 'maxWidth', label: 'W', name: 'Maximum width', icon: ArrowLineRightIcon },
		{ property: 'minHeight', label: 'H', name: 'Minimum height', icon: ArrowLineUpIcon },
		{ property: 'maxHeight', label: 'H', name: 'Maximum height', icon: ArrowLineDownIcon }
	];

	// Limits are hidden until set; "Add" reveals an empty field for the user to fill in.
	let revealed = $state<LimitProperty[]>([]);
	let limitMenuOpen = $state(false);

	function isLimitVisible(limit: LimitDefinition): boolean {
		if (revealed.includes(limit.property)) return true;
		return nodes.some((node) => limitOf(node, limit.property) !== null);
	}

	const visibleLimits = $derived(LIMITS.filter((limit) => isLimitVisible(limit)));
	const hiddenLimits = $derived(LIMITS.filter((limit) => !isLimitVisible(limit)));

	function revealLimit(limit: LimitDefinition): void {
		revealed = [...revealed, limit.property];
		limitMenuOpen = false;
	}

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

	function sharedConstraint(axis: Axis): InspectorValue<string> {
		return sharedValue(nodes, (node) => constraintOf(node, axis));
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
		>
			{#snippet trailing()}
				<BindVariable {nodes} property="width" scopes={['WIDTH_HEIGHT']} label="Width" />
			{/snippet}
		</NumberField>
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
		>
			{#snippet trailing()}
				<BindVariable {nodes} property="height" scopes={['WIDTH_HEIGHT']} label="Height" />
			{/snippet}
		</NumberField>
	</div>

	{#if showSizing || (showLimits && hiddenLimits.length > 0)}
		<div class="flex items-center gap-2" data-resizing-row>
			{#each ['horizontal', 'vertical'] as const as axis (axis)}
				{@const shared = sharedValue(nodes, (node) => currentSizing(node, axis))}
				{#if showSizing}
					<ToggleGroup
						name={axis === 'horizontal' ? 'Horizontal resizing' : 'Vertical resizing'}
						options={sizingOptions(axis)}
						value={shared.value}
						mixed={shared.mixed}
						onchange={(value) => setSizing(axis, value)}
					/>
				{/if}
			{/each}
			{#if showLimits && hiddenLimits.length > 0}
				<div class="ml-auto">
					<IconToggleButton
						icon={DotsThreeIcon}
						label="Add min or max size"
						pressed={limitMenuOpen}
						onclick={() => (limitMenuOpen = !limitMenuOpen)}
					/>
				</div>
			{/if}
		</div>
	{/if}

	{#if limitMenuOpen && hiddenLimits.length > 0}
		<div
			class="bg-raised border-line flex flex-col rounded-md border p-1 text-xs"
			role="menu"
			aria-label="Add min or max size"
			data-limit-menu
		>
			{#each hiddenLimits as limit (limit.property)}
				<button
					type="button"
					role="menuitem"
					class="text-default hover:bg-hover rounded px-2 py-1 text-left"
					onclick={() => revealLimit(limit)}
				>
					Add {limit.name.toLowerCase()}
				</button>
			{/each}
		</div>
	{/if}

	{#if showLimits && visibleLimits.length > 0}
		<div class="grid grid-cols-2 gap-2" data-limits>
			{#each visibleLimits as limit (limit.property)}
				{@const shared = sharedValue(nodes, (node) => limitOf(node, limit.property))}
				<NumberField
					label={limit.label}
					icon={limit.icon}
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
		<div class="flex items-center gap-3" data-constraints>
			<ConstraintWidget
				horizontal={sharedConstraint('horizontal').value}
				vertical={sharedConstraint('vertical').value}
				onchange={setConstraint}
			/>
			<div class="flex min-w-0 flex-1 flex-col gap-2">
				{#each ['horizontal', 'vertical'] as const as axis (axis)}
					{@const shared = sharedConstraint(axis)}
					<DropdownField
						options={CONSTRAINT_OPTIONS[axis]}
						value={shared.value}
						mixed={shared.mixed}
						onchange={(value) => setConstraint(axis, value)}
					/>
				{/each}
			</div>
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
