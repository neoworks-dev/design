<script lang="ts">
	import AlignBottomSimpleIcon from 'phosphor-svelte/lib/AlignBottomSimpleIcon';
	import AlignCenterHorizontalSimpleIcon from 'phosphor-svelte/lib/AlignCenterHorizontalSimpleIcon';
	import AlignCenterVerticalSimpleIcon from 'phosphor-svelte/lib/AlignCenterVerticalSimpleIcon';
	import AlignLeftSimpleIcon from 'phosphor-svelte/lib/AlignLeftSimpleIcon';
	import AlignRightSimpleIcon from 'phosphor-svelte/lib/AlignRightSimpleIcon';
	import AlignTopSimpleIcon from 'phosphor-svelte/lib/AlignTopSimpleIcon';
	import ArrowsHorizontalIcon from 'phosphor-svelte/lib/ArrowsHorizontalIcon';
	import ArrowsVerticalIcon from 'phosphor-svelte/lib/ArrowsVerticalIcon';
	import BroomIcon from 'phosphor-svelte/lib/BroomIcon';
	import FlipHorizontalIcon from 'phosphor-svelte/lib/FlipHorizontalIcon';
	import FlipVerticalIcon from 'phosphor-svelte/lib/FlipVerticalIcon';
	import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
	import type { Component } from 'svelte';
	import type { Node } from '../../lib/document';
	import { isAutoLayoutChild } from '../../lib/editing/selectionOps';
	import { planMoveTo, planRotateTo, rotationDegrees } from '../../lib/inspector-inputs/geometry';
	import {
		editSelection,
		selectedNodes,
		setSelectionProps
	} from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import { isStackContainer } from '../../lib/layout/build';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const ctx = getKernel();

	interface CommandButton {
		command: string;
		label: string;
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
		/** Fewest selected nodes the command makes sense for. */
		needs: number;
	}

	const ALIGN_BUTTONS: CommandButton[] = [
		{ command: 'align.left', label: 'Align left', icon: AlignLeftSimpleIcon, needs: 1 },
		{
			command: 'align.horizontal-center',
			label: 'Align horizontal centers',
			icon: AlignCenterHorizontalSimpleIcon,
			needs: 1
		},
		{ command: 'align.right', label: 'Align right', icon: AlignRightSimpleIcon, needs: 1 },
		{ command: 'align.top', label: 'Align top', icon: AlignTopSimpleIcon, needs: 1 },
		{
			command: 'align.vertical-center',
			label: 'Align vertical centers',
			icon: AlignCenterVerticalSimpleIcon,
			needs: 1
		},
		{ command: 'align.bottom', label: 'Align bottom', icon: AlignBottomSimpleIcon, needs: 1 },
		{
			command: 'align.distribute-horizontal',
			label: 'Distribute horizontal spacing',
			icon: ArrowsHorizontalIcon,
			needs: 3
		},
		{
			command: 'align.distribute-vertical',
			label: 'Distribute vertical spacing',
			icon: ArrowsVerticalIcon,
			needs: 3
		},
		{ command: 'align.tidy-up', label: 'Tidy up', icon: BroomIcon, needs: 3 }
	];

	const nodes = $derived(selectedNodes(ctx));

	// Alignment needs a frame to align to, or several nodes to align against each other.
	const showAlignment = $derived.by(() => {
		if (nodes.length > 1) return true;
		return nodes.every((node) => {
			if (node.parentId === null) return false;
			return ctx.document.require(node.parentId).type !== 'PAGE';
		});
	});
	const alignButtons = $derived(ALIGN_BUTTONS.filter((button) => ctx.commands.has(button.command)));

	function translation(node: Node): { x: number; y: number } {
		if (!('transform' in node)) return { x: 0, y: 0 };
		return { x: node.transform[0][2], y: node.transform[1][2] };
	}

	const horizontal = $derived(sharedValue(nodes, (node) => translation(node).x));
	const vertical = $derived(sharedValue(nodes, (node) => translation(node).y));
	const rotation = $derived(
		sharedValue(nodes, (node) => rotationDegrees(ctx.document.absoluteTransform(node.id)))
	);
	const controlledByLayout = $derived(
		nodes.length > 0 && nodes.every((node) => isAutoLayoutChild(ctx.document.reader, node))
	);

	// Absolute position: a child of an auto layout frame opts out of the flow and sits where it is
	// placed, while staying inside the frame.
	const inAutoLayout = $derived(
		nodes.length > 0 &&
			nodes.every((node) => {
				if (node.parentId === null) return false;
				return isStackContainer(ctx.document.require(node.parentId));
			})
	);
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

	function moveTo(axis: 'x' | 'y', value: number, gesture: NumberGesture): void {
		editSelection(ctx, { label: 'Move', mergeKey: `inspector:${axis}`, gesture }, (reader, node) =>
			planMoveTo(reader, node.id, { [axis]: value })
		);
	}

	function rotateTo(value: number, gesture: NumberGesture): void {
		editSelection(
			ctx,
			{ label: 'Rotate', mergeKey: 'inspector:rotation', gesture },
			(reader, node) => planRotateTo(reader, node.id, value)
		);
	}

	function run(command: string): void {
		void ctx.commands.run(command);
	}

	// Nine 28px buttons do not fit the 211px of a sidebar row: align on top, distribute below.
	const layoutReason = 'Position is controlled by auto layout';
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-position-section>
	{#if showAlignment && alignButtons.length > 0}
		<!-- Six columns: the align buttons fill the first row, distribute and tidy wrap below. -->
		<div class="grid grid-cols-6 justify-items-center gap-y-0.5" data-alignment-row>
			{#each alignButtons as button (button.command)}
				{@const enough = nodes.length >= button.needs}
				<IconToggleButton
					icon={button.icon}
					label={button.label}
					disabled={!enough}
					title={enough ? button.label : `${button.label}: select at least ${button.needs}`}
					onclick={() => run(button.command)}
				/>
			{/each}
		</div>
	{/if}
	<div class="grid grid-cols-2 gap-2">
		<NumberField
			label="X"
			name="X position"
			value={horizontal.value}
			mixed={horizontal.mixed}
			disabled={controlledByLayout}
			title={controlledByLayout ? layoutReason : undefined}
			onchange={(value, gesture) => moveTo('x', value, gesture)}
		/>
		<NumberField
			label="Y"
			name="Y position"
			value={vertical.value}
			mixed={vertical.mixed}
			disabled={controlledByLayout}
			title={controlledByLayout ? layoutReason : undefined}
			onchange={(value, gesture) => moveTo('y', value, gesture)}
		/>
		<NumberField
			label="R"
			name="Rotation"
			unit="°"
			value={rotation.value}
			mixed={rotation.mixed}
			onchange={rotateTo}
		/>
		<div class="flex items-center gap-1">
			<IconToggleButton
				icon={FlipHorizontalIcon}
				label="Flip horizontal"
				onclick={() => run('node.flip-horizontal')}
			/>
			<IconToggleButton
				icon={FlipVerticalIcon}
				label="Flip vertical"
				onclick={() => run('node.flip-vertical')}
			/>
			{#if inAutoLayout}
				<span data-absolute-position class="flex">
					<IconToggleButton
						icon={PushPinIcon}
						label="Absolute position"
						title="Absolute position: place freely, ignoring the auto layout flow"
						pressed={absolute}
						onclick={toggleAbsolute}
					/>
				</span>
			{/if}
		</div>
	</div>
</div>
