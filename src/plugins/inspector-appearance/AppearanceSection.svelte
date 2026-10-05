<script lang="ts">
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import MaskHappyIcon from 'phosphor-svelte/lib/MaskHappyIcon';
	import SquareHalfIcon from 'phosphor-svelte/lib/SquareHalfIcon';
	import { BLEND_MODES, type Node } from '../../lib/document';
	import {
		boundVariableName,
		selectedNodes,
		setSelectionProps
	} from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import SliderField from '../../lib/ui/SliderField.svelte';
	import { cornersOf, uniformRadius, blendLabel, type Corners } from './corners';

	const ctx = getKernel();

	const nodes = $derived(selectedNodes(ctx));

	const BLEND_OPTIONS = BLEND_MODES.map((mode) => ({ value: mode, label: blendLabel(mode) }));
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

	// ---------- blend mode ----------

	const blend = $derived(
		sharedValue(nodes, (node) => ('blendMode' in node ? node.blendMode : null))
	);

	function setBlend(mode: string): void {
		setSelectionProps(
			ctx,
			{ label: 'Change blend mode', mergeKey: 'inspector:blend', gesture: 'commit' },
			(node) => {
				if (!('blendMode' in node)) return {};
				return { blendMode: mode };
			}
		);
	}

	// ---------- visibility and mask ----------

	const visible = $derived(sharedValue(nodes, (node) => 'visible' in node && node.visible));
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

<div class="flex flex-col gap-2 px-3 pb-3" data-appearance-section>
	<SliderField
		label="%"
		name="Opacity"
		min={0}
		max={100}
		value={opacity.value}
		mixed={opacity.mixed}
		disabled={opacityVariable !== undefined}
		onchange={setOpacity}
	/>

	<div class="flex items-center gap-1">
		<div class="min-w-0 flex-1" data-blend-mode>
			<DropdownField
				options={BLEND_OPTIONS}
				value={blend.value}
				mixed={blend.mixed}
				onchange={setBlend}
			/>
		</div>
		<IconToggleButton
			icon={visible.value === true ? EyeIcon : EyeSlashIcon}
			label="Visibility"
			title={visible.value === true ? 'Hide' : 'Show'}
			pressed={visible.value === true}
			onclick={() => void ctx.commands.run('node.toggle-visibility')}
		/>
		{#if canMask}
			<IconToggleButton
				icon={MaskHappyIcon}
				label="Use as mask"
				pressed={masked.value === true}
				onclick={() => void ctx.commands.run('mask.toggle')}
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

	{#if hasCorners}
		<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1" data-corner-radius>
			<NumberField
				label="⌜"
				name="Corner radius"
				min={0}
				value={radius.value}
				mixed={radius.mixed || radius.value === null}
				boundTo={radiusVariable}
				disabled={radiusVariable !== undefined}
				onchange={setRadius}
			/>
			<IconToggleButton
				icon={SquareHalfIcon}
				label="Independent corners"
				pressed={showPerCorner}
				onclick={() => (perCorner = !perCorner)}
			/>
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
		{#if showPerCorner}
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
			</div>
		{/if}
	{/if}
</div>
