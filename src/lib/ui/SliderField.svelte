<script lang="ts">
	import { Slider } from '@neoworks-dev/ui';
	import NumberField from './NumberField.svelte';
	import type { NumberGesture } from './numberField';

	let {
		label,
		name,
		value,
		mixed = false,
		min,
		max,
		step = 1,
		unit = '',
		precision = 2,
		disabled = false,
		onchange
	}: {
		label: string;
		name: string;
		value: number | null;
		mixed?: boolean;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		precision?: number;
		disabled?: boolean;
		onchange: (value: number, gesture: NumberGesture) => void;
	} = $props();

	const sliderValue = $derived.by(() => {
		if (value === null) return min;
		return value;
	});
</script>

<!-- A range slider next to a number field; dragging the slider is a scrub gesture. -->
<div class="flex items-center gap-2" data-slider-field={name}>
	<div class="min-w-0 flex-1">
		<Slider
			label="{name} slider"
			{min}
			{max}
			{step}
			{disabled}
			value={sliderValue}
			oninput={(next) => onchange(next, 'scrub')}
			onchange={(next) => onchange(next, 'commit')}
		/>
	</div>
	<div class="w-20 shrink-0">
		<NumberField
			{label}
			{name}
			{value}
			{mixed}
			{min}
			{max}
			{step}
			{unit}
			{precision}
			{disabled}
			{onchange}
		/>
	</div>
</div>
