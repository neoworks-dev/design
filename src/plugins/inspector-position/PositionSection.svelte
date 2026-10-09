<script lang="ts">
	import AlignBottomSimpleIcon from 'phosphor-svelte/lib/AlignBottomSimpleIcon';
	import AlignCenterHorizontalSimpleIcon from 'phosphor-svelte/lib/AlignCenterHorizontalSimpleIcon';
	import AlignCenterVerticalSimpleIcon from 'phosphor-svelte/lib/AlignCenterVerticalSimpleIcon';
	import AlignLeftSimpleIcon from 'phosphor-svelte/lib/AlignLeftSimpleIcon';
	import AlignRightSimpleIcon from 'phosphor-svelte/lib/AlignRightSimpleIcon';
	import AlignTopSimpleIcon from 'phosphor-svelte/lib/AlignTopSimpleIcon';
	import AngleIcon from 'phosphor-svelte/lib/AngleIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import ArrowsHorizontalIcon from 'phosphor-svelte/lib/ArrowsHorizontalIcon';
	import ArrowsVerticalIcon from 'phosphor-svelte/lib/ArrowsVerticalIcon';
	import BroomIcon from 'phosphor-svelte/lib/BroomIcon';
	import FlipHorizontalIcon from 'phosphor-svelte/lib/FlipHorizontalIcon';
	import FlipVerticalIcon from 'phosphor-svelte/lib/FlipVerticalIcon';
	import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
	import type { Component, ComponentProps } from 'svelte';
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
	import IconButtonGroup from '../../lib/ui/IconButtonGroup.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	type GroupButton = ComponentProps<typeof IconButtonGroup>['buttons'][number];

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

	const layoutReason = 'Position is controlled by auto layout';

	function commandButton(button: CommandButton): GroupButton {
		const enough = nodes.length >= button.needs;
		let title = button.label;
		if (!enough) title = `${button.label}: select at least ${button.needs}`;
		return {
			label: button.label,
			icon: button.icon,
			disabled: !enough,
			title,
			onclick: () => run(button.command)
		};
	}

	function alignGroup(commands: string[]): GroupButton[] {
		return alignButtons.filter((button) => commands.includes(button.command)).map(commandButton);
	}

	const horizontalAlign = $derived(
		alignGroup(['align.left', 'align.horizontal-center', 'align.right'])
	);
	const verticalAlign = $derived(
		alignGroup(['align.top', 'align.vertical-center', 'align.bottom'])
	);
	const distributeGroup = $derived(
		alignGroup(['align.distribute-horizontal', 'align.distribute-vertical', 'align.tidy-up'])
	);

	function rotateQuarterTurn(): void {
		editSelection(
			ctx,
			{ label: 'Rotate 90 degrees', mergeKey: 'inspector:rotate-90', gesture: 'commit' },
			(reader, node) =>
				planRotateTo(reader, node.id, rotationDegrees(reader.cache.absoluteTransform(node.id)) + 90)
		);
	}

	const transformGroup = $derived<GroupButton[]>([
		{ label: 'Rotate 90 degrees', icon: ArrowClockwiseIcon, onclick: rotateQuarterTurn },
		{
			label: 'Flip horizontal',
			icon: FlipHorizontalIcon,
			onclick: () => run('node.flip-horizontal')
		},
		{ label: 'Flip vertical', icon: FlipVerticalIcon, onclick: () => run('node.flip-vertical') }
	]);
</script>

<div class="flex flex-col gap-2 px-4 pb-4" data-position-section>
	{#if showAlignment && alignButtons.length > 0}
		<div class="grid grid-cols-[1fr_1fr_32px] gap-2" data-alignment-row>
			<IconButtonGroup name="Align horizontally" buttons={horizontalAlign} />
			<IconButtonGroup name="Align vertically" buttons={verticalAlign} />
		</div>
		{#if nodes.length > 1 && distributeGroup.length > 0}
			<div class="grid grid-cols-[1fr_1fr_32px] gap-2" data-distribute-row>
				<IconButtonGroup name="Distribute" buttons={distributeGroup} />
			</div>
		{/if}
	{/if}
	<div class="grid grid-cols-[1fr_1fr_32px] gap-2">
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
		{#if inAutoLayout}
			<span data-absolute-position class="flex">
				<IconToggleButton
					icon={PushPinIcon}
					label="Absolute position"
					title="Absolute position: place freely, ignoring the auto layout flow"
					pressed={absolute}
					filled
					onclick={toggleAbsolute}
				/>
			</span>
		{/if}
	</div>
	<div class="grid grid-cols-[1fr_1fr_32px] gap-2">
		<NumberField
			label="R"
			icon={AngleIcon}
			name="Rotation"
			unit="°"
			value={rotation.value}
			mixed={rotation.mixed}
			onchange={rotateTo}
		/>
		<div class="col-span-2">
			<IconButtonGroup name="Rotate and flip" buttons={transformGroup} />
		</div>
	</div>
</div>
