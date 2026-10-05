<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		clampValue,
		formatNumber,
		parseFieldText,
		stepSize,
		stepValue,
		type NumberGesture
	} from './numberField';

	let {
		label,
		name,
		value,
		mixed = false,
		unit = '',
		min = undefined,
		max = undefined,
		step = 1,
		precision = 2,
		disabled = false,
		scrub = true,
		title = undefined,
		boundTo = undefined,
		placeholder = '',
		onclear = undefined,
		trailing = undefined,
		onchange
	}: {
		/** Short glyph in front of the input (`X`, `W`, an angle sign). Dragging it scrubs. */
		label: string;
		/** The accessible name of the input. */
		name: string;
		/** Current value; `null` shows an empty field. */
		value: number | null;
		/** Selected things disagree: the input is empty and says "Mixed". */
		mixed?: boolean;
		unit?: string;
		min?: number;
		max?: number;
		/** Size of one Up/Down press and one scrubbed pixel (Shift x10, Alt /10 on Up/Down). */
		step?: number;
		/** Decimals kept when showing and stepping. */
		precision?: number;
		disabled?: boolean;
		scrub?: boolean;
		/** Tooltip, also the reason when the field is disabled. */
		title?: string;
		/** Name of the variable the value is bound to; marks the field as bound. */
		boundTo?: string;
		/** Shown while the field is empty and not mixed (for optional values: "None"). */
		placeholder?: string;
		/** Makes the value optional: committing an empty text calls this instead of reverting. */
		onclear?: () => void;
		/** Content after the value (the variable binding button). Shown on hover or focus. */
		trailing?: Snippet;
		onchange: (value: number, gesture: NumberGesture) => void;
	} = $props();

	let draft = $state<string | null>(null);
	let input = $state<HTMLInputElement>();
	let scrubStart: { pointerX: number; value: number } | null = null;

	function display(): string {
		if (mixed || value === null) return '';
		return formatNumber(value, precision);
	}

	const shown = $derived(draft === null ? display() : draft);

	// The DOM value follows `shown`, plus a nudge after a revert: Svelte skips an attribute whose
	// text did not change, so typed junk that is rejected would otherwise stay in the input.
	let revision = $state(0);

	$effect(() => {
		void revision;
		if (input && input.value !== shown) input.value = shown;
	});

	function restore(): void {
		draft = null;
		revision += 1;
	}

	function emit(next: number, gesture: NumberGesture): void {
		onchange(clampValue(next, min, max), gesture);
	}

	function commit(): void {
		if (draft === null) return;
		const text = draft;
		const parsed = parseFieldText(text, value, unit);
		restore();
		if (text.trim() === '' && onclear !== undefined && (value !== null || mixed)) {
			onclear();
			return;
		}
		if (parsed === null) return;
		if (!mixed && parsed === value) return;
		emit(parsed, 'commit');
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			commit();
			input?.blur();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			restore();
			input?.blur();
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const base = parseFieldText(shown, value, unit);
		const current = base === null ? 0 : base;
		const size = stepSize(step, { shift: event.shiftKey, alt: event.altKey });
		const direction = event.key === 'ArrowUp' ? 1 : -1;
		draft = null;
		emit(stepValue(current, direction * size, precision), 'step');
	}

	function onlabelpointerdown(event: PointerEvent): void {
		if (disabled || !scrub) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		event.preventDefault();
		scrubStart = { pointerX: event.clientX, value: value === null ? 0 : value };
		handle.setPointerCapture?.(event.pointerId);
	}

	function onlabelpointermove(event: PointerEvent): void {
		if (scrubStart === null) return;
		const amount =
			(event.clientX - scrubStart.pointerX) * stepSize(step, { shift: event.shiftKey, alt: false });
		emit(stepValue(scrubStart.value, amount, precision), 'scrub');
	}

	function onlabelpointerup(event: PointerEvent): void {
		if (scrubStart === null) return;
		scrubStart = null;
		const handle = event.currentTarget;
		if (handle instanceof HTMLElement) handle.releasePointerCapture?.(event.pointerId);
	}
</script>

<div
	class={[
		'group bg-input border-line hover:border-line-strong focus-within:border-action flex h-7 min-w-0 items-center rounded-md border text-xs',
		disabled && 'opacity-50',
		boundTo !== undefined && 'border-action'
	]}
	data-number-field={name}
	data-mixed={mixed || undefined}
	title={boundTo === undefined ? title : `Bound to ${boundTo}`}
>
	<span
		class={[
			'text-faint flex h-full min-w-6 shrink-0 items-center justify-center px-1 select-none',
			scrub && !disabled && 'cursor-ew-resize'
		]}
		data-number-label
		aria-hidden="true"
		onpointerdown={onlabelpointerdown}
		onpointermove={onlabelpointermove}
		onpointerup={onlabelpointerup}
		onpointercancel={onlabelpointerup}
	>
		{label}
	</span>
	<input
		bind:this={input}
		type="text"
		inputmode="decimal"
		aria-label={name}
		placeholder={mixed ? 'Mixed' : placeholder}
		{disabled}
		class="text-default placeholder:text-muted h-full min-w-0 flex-1 bg-transparent pr-1 tabular-nums outline-none"
		onfocus={() => input?.select()}
		oninput={(event) => (draft = event.currentTarget.value)}
		onblur={commit}
		{onkeydown}
	/>
	{#if unit !== ''}
		<span class="text-faint pr-2 select-none">{unit}</span>
	{/if}
	{#if trailing !== undefined}
		<span class="flex shrink-0 items-center pr-1" data-number-trailing>{@render trailing()}</span>
	{/if}
</div>
