<script lang="ts">
	import { Select } from '@neoworks-dev/ui';

	let {
		options,
		value,
		mixed = false,
		placeholder = 'Select',
		disabled = false,
		onchange
	}: {
		options: Array<{ value: string; label: string }>;
		value: string | null;
		/** Selected things disagree: no option is selected and the trigger says "Mixed". */
		mixed?: boolean;
		placeholder?: string;
		disabled?: boolean;
		onchange: (value: string) => void;
	} = $props();

	const selected = $derived.by(() => {
		if (mixed || value === null) return '';
		return value;
	});
</script>

<!-- A ghost `Select` set in an inspector row. Adds the Mixed state the base component lacks. -->
<Select
	{options}
	value={selected}
	placeholder={mixed ? 'Mixed' : placeholder}
	{disabled}
	size="sm"
	onChange={(next) => {
		if (typeof next === 'string') onchange(next);
	}}
/>
