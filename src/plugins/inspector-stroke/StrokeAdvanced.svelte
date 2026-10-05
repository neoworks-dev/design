<script lang="ts">
	import type { Node, Stroke } from '../../lib/document';
	import {
		dashAndGap,
		dashedPattern,
		defaultDashPattern,
		type StrokeCap
	} from '../../lib/editing/strokes';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import Popover from '../../lib/ui/Popover.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';

	let {
		anchor,
		nodes,
		onedit,
		onclose
	}: {
		anchor: { x: number; y: number; width: number; height: number };
		nodes: Node[];
		onedit: (label: string, gesture: NumberGesture, change: (stroke: Stroke) => Stroke) => void;
		onclose: () => void;
	} = $props();

	const TABS = [
		{ value: 'basic', label: 'Basic' },
		{ value: 'dynamic', label: 'Dynamic', disabled: true, title: 'Dynamic strokes come later' },
		{ value: 'brush', label: 'Brush', disabled: true, title: 'Brush strokes come later' }
	];
	const STYLES = [
		{ value: 'solid', label: 'Solid' },
		{ value: 'dash', label: 'Dash' }
	];
	const CAPS = [
		{ value: 'NONE', label: 'None' },
		{ value: 'ROUND', label: 'Round' },
		{ value: 'SQUARE', label: 'Square' }
	];
	const ARROW_CAPS = [
		{ value: 'ARROW_LINES', label: 'Arrow' },
		{ value: 'ARROW_EQUILATERAL', label: 'Triangle' }
	];
	const JOINS = [
		{ value: 'MITER', label: 'Miter' },
		{ value: 'BEVEL', label: 'Bevel' },
		{ value: 'ROUND', label: 'Round' }
	];

	function first(node: Node): Stroke | undefined {
		if (!('strokes' in node)) return undefined;
		return node.strokes[0];
	}

	const pattern = $derived(sharedValue(nodes, (node) => first(node)?.dashPattern));
	const cap = $derived(sharedValue(nodes, (node) => first(node)?.cap));
	const join = $derived(sharedValue(nodes, (node) => first(node)?.join));
	const miterLimit = $derived(sharedValue(nodes, (node) => first(node)?.miterLimit));
	const isOpenPath = $derived(
		nodes.length > 0 && nodes.every((node) => node.type === 'LINE' || node.type === 'VECTOR')
	);
	const dashed = $derived(
		pattern.value !== null && pattern.value !== undefined && pattern.value.length > 0
	);
	const lengths = $derived.by(() => {
		if (pattern.value === null || pattern.value === undefined) return { dash: 0, gap: 0 };
		return dashAndGap(pattern.value);
	});

	function setStyle(style: string): void {
		onedit('Change stroke style', 'commit', (stroke) => {
			if (style === 'solid') return { ...stroke, dashPattern: [] };
			return { ...stroke, dashPattern: defaultDashPattern() };
		});
	}

	function setDash(value: number, gesture: NumberGesture): void {
		onedit('Change stroke dash', gesture, (stroke) => ({
			...stroke,
			dashPattern: dashedPattern(value, dashAndGap(stroke.dashPattern).gap)
		}));
	}

	function setGap(value: number, gesture: NumberGesture): void {
		onedit('Change stroke gap', gesture, (stroke) => ({
			...stroke,
			dashPattern: dashedPattern(dashAndGap(stroke.dashPattern).dash, value)
		}));
	}
</script>

<Popover {anchor} label="Stroke settings" {onclose}>
	<div class="flex flex-col gap-3 p-3" data-stroke-advanced>
		<ToggleGroup name="Stroke settings tab" options={TABS} value="basic" onchange={() => {}} />

		<div class="flex flex-col gap-1">
			<span class="text-faint text-xs">Style</span>
			<ToggleGroup
				name="Stroke style"
				options={STYLES}
				value={dashed ? 'dash' : 'solid'}
				mixed={pattern.mixed}
				onchange={setStyle}
			/>
		</div>
		{#if dashed}
			<div class="grid grid-cols-2 gap-2">
				<NumberField label="D" name="Dash" min={0} value={lengths.dash} onchange={setDash} />
				<NumberField label="G" name="Gap" min={0} value={lengths.gap} onchange={setGap} />
			</div>
		{/if}

		<div class="flex flex-col gap-1">
			<span class="text-faint text-xs">Ends</span>
			<ToggleGroup
				name="Stroke ends"
				options={isOpenPath ? [...CAPS, ...ARROW_CAPS] : CAPS}
				value={cap.value === undefined ? null : cap.value}
				mixed={cap.mixed}
				onchange={(value) =>
					onedit('Change stroke ends', 'commit', (stroke) => ({
						...stroke,
						cap: value as StrokeCap
					}))}
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-faint text-xs">Join</span>
			<ToggleGroup
				name="Stroke join"
				options={JOINS}
				value={join.value === undefined ? null : join.value}
				mixed={join.mixed}
				onchange={(value) =>
					onedit('Change stroke join', 'commit', (stroke) => ({
						...stroke,
						join: value as Stroke['join']
					}))}
			/>
		</div>
		{#if join.value === 'MITER'}
			<NumberField
				label="∠"
				name="Miter limit"
				min={1}
				value={miterLimit.value === undefined ? null : miterLimit.value}
				mixed={miterLimit.mixed}
				onchange={(value, gesture) =>
					onedit('Change miter limit', gesture, (stroke) => ({ ...stroke, miterLimit: value }))}
			/>
		{/if}
	</div>
</Popover>
