<script lang="ts">
	import { colorToHex, hexToColor, type SwatchColor } from './color';

	let {
		name,
		color,
		mixed = false,
		disabled = false,
		onchange
	}: {
		/** Accessible name, for example "Page background". */
		name: string;
		color: SwatchColor | null;
		mixed?: boolean;
		disabled?: boolean;
		onchange: (color: SwatchColor) => void;
	} = $props();

	const hex = $derived.by(() => {
		if (color === null) return '#000000';
		return colorToHex(color);
	});
</script>

<!-- A swatch that opens the system colour picker. Mixed shows a diagonal split. -->
<label
	class={[
		'border-line relative inline-flex size-6 shrink-0 cursor-pointer overflow-hidden rounded border',
		disabled && 'opacity-50'
	]}
	data-color-swatch={name}
	data-mixed={mixed || undefined}
>
	<span
		class="absolute inset-0"
		style:background={mixed ? 'linear-gradient(135deg, #fff 50%, #999 50%)' : hex}
	></span>
	<input
		type="color"
		aria-label={name}
		{disabled}
		value={hex}
		class="absolute inset-0 size-full cursor-pointer opacity-0"
		oninput={(event) => onchange(hexToColor(event.currentTarget.value))}
	/>
</label>
