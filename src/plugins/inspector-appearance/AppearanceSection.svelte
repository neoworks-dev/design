<script lang="ts">
	import CheckerboardIcon from 'phosphor-svelte/lib/CheckerboardIcon';
	import CornersOutIcon from 'phosphor-svelte/lib/CornersOutIcon';
	import SquareHalfIcon from 'phosphor-svelte/lib/SquareHalfIcon';
	import type { Node } from '../../lib/document';
	import {
		boundVariableName,
		selectedNodes,
		setSelectionProps
	} from '../../lib/inspector-inputs/selectionEdit';
	import BindVariable from '../../lib/inspector-inputs/BindVariable.svelte';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import { cornersOf, uniformRadius, type Corners } from './corners';

	const ctx = getKernel();

	const nodes = $derived(selectedNodes(ctx));

	const MASK_TYPES = [
		{ value: 'ALPHA', label: 'Alpha' },
		{ value: 'VECTOR', label: 'Vector' },
		{ value: 'LUMINANCE', label: 'Luminance' }
	];
	const CORNER_NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

	// ---------- opacity ----------

	const opacity = $derived(
		sharedValue(nodes, (node) => ('opacity' in node ? Math.round(node.opacity * 10000) / 100 : 100))
	);
	const opacityVariable = $derived(boundVariableName(ctx, nodes, 'opacity'));

	function setOpacity(percent: number): void {
		void ctx.commands.run('node.set-opacity', { value: percent / 100 });
	}

	// ---------- visibility and mask ----------

	const masked = $derived(sharedValue(nodes, (node) => 'isMask' in node && node.isMask));
	const maskType = $derived(
		sharedValue(nodes, (node) => ('maskType' in node ? node.maskType : null))
	);
	const canMask = $derived(nodes.length > 0 && nodes.every((node) => 'isMask' in node));

	// ---------- corner radius ----------

	const hasCorners = $derived(nodes.length > 0 && nodes.every((node) => 'cornerRadius' in node));
	const radius = $derived(sharedValue(nodes, (node) => uniformRadius(node)));
	const radiusVariable = $derived(boundVariableName(ctx, nodes, 'cornerRadius'));
	const corners = $derived(sharedValue(nodes, (node) => cornersOf(node)));
	const smoothing = $derived(
		sharedValue(nodes, (node) =>
			'cornerSmoothing' in node ? Math.round(node.cornerSmoothing * 100) : 0
		)
	);
	let perCorner = $state(false);
	const showPerCorner = $derived(perCorner || (!radius.mixed && radius.value === null));

	function setRadius(value: number, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change corner radius', mergeKey: 'inspector:radius', gesture },
			(node) => {
				if (!('cornerRadius' in node)) return {};
				return { cornerRadius: value };
			}
		);
	}

	function setCorner(index: number, value: number, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change corner radius', mergeKey: `inspector:corner-${index}`, gesture },
			(node) => {
				if (!('cornerRadius' in node)) return {};
				const next: Corners = [...cornersOf(node)];
				next[index] = value;
				return { cornerRadius: next };
			}
		);
	}

	function setSmoothing(percent: number, gesture: NumberGesture): void {
		setSelectionProps(
			ctx,
			{ label: 'Change corner smoothing', mergeKey: 'inspector:smoothing', gesture },
			(node: Node) => {
				if (!('cornerSmoothing' in node)) return {};
				return { cornerSmoothing: percent / 100 };
			}
		);
	}

	function cornerValue(index: number): number | null {
		if (corners.value === null) return null;
		return corners.value[index];
	}
</script>

<div class="flex flex-col gap-2 px-4 pb-4" data-appearance-section>
	<div class="grid grid-cols-[1fr_1fr_32px] gap-2">
		<NumberField
			label="%"
			icon={CheckerboardIcon}
			name="Opacity"
			unit="%"
			min={0}
			max={100}
			value={opacity.value}
			mixed={opacity.mixed}
			disabled={opacityVariable !== undefined}
			onchange={(value) => setOpacity(value)}
		/>
		{#if hasCorners}
			<NumberField
				label="⌜"
				icon={CornersOutIcon}
				name="Corner radius"
				min={0}
				value={radius.value}
				mixed={radius.mixed || radius.value === null}
				boundTo={radiusVariable}
				disabled={radiusVariable !== undefined}
				onchange={setRadius}
			>
				{#snippet trailing()}
					<BindVariable
						{nodes}
						property="cornerRadius"
						scopes={['CORNER_RADIUS']}
						label="Corner radius"
					/>
				{/snippet}
			</NumberField>
			<IconToggleButton
				icon={SquareHalfIcon}
				label="Independent corners"
				title="Independent corners and smoothing"
				filled
				pressed={showPerCorner}
				onclick={() => (perCorner = !perCorner)}
			/>
		{/if}
	</div>

	{#if canMask && masked.value === true}
		<div data-mask-type>
			<DropdownField
				options={MASK_TYPES}
				value={maskType.value}
				mixed={maskType.mixed}
				onchange={(type) => void ctx.commands.run(`mask.type-${type.toLowerCase()}`)}
			/>
		</div>
	{/if}

	{#if hasCorners && showPerCorner}
		<div class="grid grid-cols-2 gap-2" data-corner-fields>
			{#each CORNER_NAMES as cornerName, index (cornerName)}
				<NumberField
					label={['TL', 'TR', 'BR', 'BL'][index]}
					name={cornerName}
					min={0}
					value={cornerValue(index)}
					mixed={corners.mixed}
					onchange={(value, gesture) => setCorner(index, value, gesture)}
				/>
			{/each}
			<NumberField
				label="~"
				name="Corner smoothing"
				unit="%"
				min={0}
				max={100}
				value={smoothing.value}
				mixed={smoothing.mixed}
				onchange={setSmoothing}
			/>
		</div>
	{/if}
</div>
