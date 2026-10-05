<script lang="ts">
	import EyedropperIcon from 'phosphor-svelte/lib/EyedropperIcon';
	import { untrack } from 'svelte';
	import type { RGBA } from '../document/types';
	import {
		hslToRgb,
		hsvToRgb,
		parseHex,
		rgbaCss,
		rgbToHex,
		rgbToHsl,
		rgbToHsv,
		shiftLightness,
		type Hsv
	} from './colorMath';
	import DropdownField from './DropdownField.svelte';
	import IconToggleButton from './IconToggleButton.svelte';
	import NumberField from './NumberField.svelte';
	import type { NumberGesture } from './numberField';

	let {
		color,
		variables = [],
		boundVariableId = undefined,
		recentColors = [],
		documentColors = [],
		eyedropper = undefined,
		onchange,
		onbind = undefined
	}: {
		color: RGBA;
		/** Colour variables the colour can be bound to (already filtered by scope). */
		variables?: Array<{ id: string; name: string; color: RGBA }>;
		boundVariableId?: string;
		recentColors?: RGBA[];
		documentColors?: RGBA[];
		/** Samples a colour from the screen; absent when the platform has no eyedropper. */
		eyedropper?: () => Promise<RGBA | undefined>;
		/** `scrub` while a drag is in progress, `commit` for typed or picked values. */
		onchange: (color: RGBA, gesture: NumberGesture) => void;
		/** Bind to a variable, or unbind with `null`. */
		onbind?: (variableId: string | null) => void;
	} = $props();

	type Tab = 'custom' | 'variables';
	type Mode = 'HEX' | 'RGB' | 'HSL' | 'HSB';

	const MODES = ['HEX', 'RGB', 'HSL', 'HSB'].map((mode) => ({ value: mode, label: mode }));
	const CHECKER = 'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px';

	let tab = $state<Tab>('custom');
	let mode = $state<Mode>('HEX');
	// Hue and saturation are not recoverable from grey RGB, so the picker keeps its own HSV and
	// only resets it when the colour changes from outside.
	let hsv = $state<Hsv>(untrack(() => rgbToHsv(color)));
	let hexDraft = $state<string | null>(null);
	// Set while a typed hex is being previewed, until the gesture is committed.
	let hexTyping = false;

	function near(first: number, second: number): boolean {
		return Math.abs(first - second) < 1e-9;
	}

	$effect.pre(() => {
		const current = hsvToRgb(untrack(() => hsv));
		if (near(current.r, color.r) && near(current.g, color.g) && near(current.b, color.b)) return;
		hsv = rgbToHsv(color);
	});

	function emitHsv(next: Hsv, gesture: NumberGesture): void {
		hsv = next;
		onchange({ ...hsvToRgb(next), a: color.a }, gesture);
	}

	function emitRgba(next: RGBA, gesture: NumberGesture): void {
		hsv = rgbToHsv(next);
		onchange(next, gesture);
	}

	function trackPointer(
		event: PointerEvent,
		update: (fractionX: number, fractionY: number) => void
	): void {
		const element = event.currentTarget;
		if (!(element instanceof HTMLElement)) return;
		element.setPointerCapture(event.pointerId);
		const move = (moveEvent: PointerEvent): void => {
			const box = element.getBoundingClientRect();
			const x = Math.min(1, Math.max(0, (moveEvent.clientX - box.left) / box.width));
			const y = Math.min(1, Math.max(0, (moveEvent.clientY - box.top) / box.height));
			update(x, y);
		};
		const finish = (): void => {
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerup', finish);
		};
		element.addEventListener('pointermove', move);
		element.addEventListener('pointerup', finish);
		move(event);
	}

	function pickSaturation(event: PointerEvent): void {
		trackPointer(event, (x, y) => emitHsv({ h: hsv.h, s: x, v: 1 - y }, 'scrub'));
	}
	function pickHue(event: PointerEvent): void {
		trackPointer(event, (x) => emitHsv({ ...hsv, h: x * 360 }, 'scrub'));
	}
	function pickAlpha(event: PointerEvent): void {
		trackPointer(event, (x) => onchange({ ...color, a: x }, 'scrub'));
	}

	// ---------- hex ----------

	const hexText = $derived(rgbToHex(color));
	// Left half shows the opaque colour, right half the colour over a checkerboard.
	const previewBackground = $derived.by(() => {
		const opaque = rgbaCss(color, 1);
		const translucent = rgbaCss(color, color.a);
		return `linear-gradient(${opaque}, ${opaque}) no-repeat left / 50% 100%, linear-gradient(${translucent}, ${translucent}), ${CHECKER}`;
	});

	function parseHexDraft(draft: string): RGBA | undefined {
		const text = draft.replace('#', '');
		const parsed = parseHex(text);
		if (parsed === undefined) return undefined;
		if (text.length === 8) return parsed;
		return { r: parsed.r, g: parsed.g, b: parsed.b, a: color.a };
	}

	// Typing a valid hex previews live as a scrub; Enter or blur ends the gesture with a commit.
	function onHexInput(text: string): void {
		hexTyping = true;
		hexDraft = text;
		const parsed = parseHexDraft(text);
		if (parsed === undefined) return;
		emitRgba(parsed, 'scrub');
	}

	function commitHex(): void {
		if (hexDraft === null) return;
		const parsed = parseHexDraft(hexDraft);
		hexDraft = null;
		hexTyping = false;
		if (parsed === undefined) {
			emitRgba(color, 'commit');
			return;
		}
		emitRgba(parsed, 'commit');
	}

	// Closing the popover mid-typing must still end the scrub gesture.
	$effect(() => () => {
		if (!hexTyping) return;
		hexTyping = false;
		onchange(color, 'commit');
	});

	function onHexKey(event: KeyboardEvent): void {
		if (event.key === 'Enter') commitHex();
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		let amount = 0.01;
		if (event.shiftKey) amount = 0.1;
		if (event.key === 'ArrowDown') amount = -amount;
		emitRgba(shiftLightness(color, amount), 'commit');
	}

	// ---------- numeric modes ----------

	const rgbFields = $derived([
		{ label: 'R', name: 'Red', value: color.r * 255, max: 255 },
		{ label: 'G', name: 'Green', value: color.g * 255, max: 255 },
		{ label: 'B', name: 'Blue', value: color.b * 255, max: 255 }
	]);
	const hslValues = $derived(rgbToHsl(color));
	const hslFields = $derived([
		{ label: 'H', name: 'Hue', value: hslValues.h, max: 360 },
		{ label: 'S', name: 'Saturation', value: hslValues.s * 100, max: 100 },
		{ label: 'L', name: 'Lightness', value: hslValues.l * 100, max: 100 }
	]);
	const hsbFields = $derived([
		{ label: 'H', name: 'Hue', value: hsv.h, max: 360 },
		{ label: 'S', name: 'Saturation', value: hsv.s * 100, max: 100 },
		{ label: 'B', name: 'Brightness', value: hsv.v * 100, max: 100 }
	]);
	const numericFields = $derived.by(() => {
		if (mode === 'RGB') return rgbFields;
		if (mode === 'HSL') return hslFields;
		return hsbFields;
	});

	function setNumeric(index: number, value: number): void {
		const values = numericFields.map((field) => field.value);
		values[index] = value;
		if (mode === 'RGB') {
			emitRgba(
				{ r: values[0] / 255, g: values[1] / 255, b: values[2] / 255, a: color.a },
				'commit'
			);
			return;
		}
		if (mode === 'HSL') {
			const rgb = hslToRgb({ h: values[0], s: values[1] / 100, l: values[2] / 100 });
			emitRgba({ ...rgb, a: color.a }, 'commit');
			return;
		}
		emitHsv({ h: values[0], s: values[1] / 100, v: values[2] / 100 }, 'commit');
	}

	async function sample(): Promise<void> {
		if (eyedropper === undefined) return;
		const picked = await eyedropper();
		if (picked === undefined) return;
		emitRgba({ ...picked, a: color.a }, 'commit');
	}

	function swatchStyle(swatch: RGBA): string {
		return rgbaCss(swatch, swatch.a);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="flex min-w-0 flex-col gap-2 p-2 outline-none"
	data-color-picker
	role="group"
	aria-label="Colour picker"
	onkeydown={(event) => {
		if (event.key.toLowerCase() !== 'i' || event.target instanceof HTMLInputElement) return;
		void sample();
	}}
>
	<div class="flex items-center gap-1" role="tablist">
		{#each ['custom', 'variables'] as const as name (name)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === name}
				class={[
					'rounded px-2 py-0.5 text-xs capitalize',
					tab === name ? 'bg-raised text-default' : 'text-muted hover:text-default'
				]}
				onclick={() => (tab = name)}>{name === 'custom' ? 'Custom' : 'Variables'}</button
			>
		{/each}
	</div>

	{#if tab === 'custom'}
		<div
			class="relative h-36 w-full cursor-crosshair touch-none overflow-hidden rounded"
			style:background-color="hsl({hsv.h}, 100%, 50%)"
			role="slider"
			tabindex="-1"
			aria-label="Saturation and brightness"
			aria-valuenow={Math.round(hsv.s * 100)}
			data-saturation-area
			onpointerdown={pickSaturation}
		>
			<div
				class="absolute inset-0"
				style:background="linear-gradient(to right, #fff, transparent)"
			></div>
			<div
				class="absolute inset-0"
				style:background="linear-gradient(to top, #000, transparent)"
			></div>
			<div
				class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
				style:left="{hsv.s * 100}%"
				style:top="{(1 - hsv.v) * 100}%"
			></div>
		</div>

		<div class="flex items-center gap-2">
			{#if eyedropper}
				<IconToggleButton icon={EyedropperIcon} label="Eyedropper" onclick={() => void sample()} />
			{/if}
			<div class="flex min-w-0 flex-1 flex-col gap-2">
				<div
					class="relative h-3 cursor-pointer touch-none rounded-full"
					style:background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
					role="slider"
					tabindex="-1"
					aria-label="Hue"
					aria-valuenow={Math.round(hsv.h)}
					data-hue-slider
					onpointerdown={pickHue}
				>
					<div
						class="pointer-events-none absolute top-0 size-3 -translate-x-1/2 rounded-full border-2 border-white shadow"
						style:left="{(hsv.h / 360) * 100}%"
					></div>
				</div>
				<div
					class="relative h-3 cursor-pointer touch-none rounded-full"
					style:background="linear-gradient(to right, transparent, {rgbaCss(color, 1)}), {CHECKER}"
					role="slider"
					tabindex="-1"
					aria-label="Alpha"
					aria-valuenow={Math.round(color.a * 100)}
					data-alpha-slider
					onpointerdown={pickAlpha}
				>
					<div
						class="pointer-events-none absolute top-0 size-3 -translate-x-1/2 rounded-full border-2 border-white shadow"
						style:left="{color.a * 100}%"
					></div>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-1">
			<DropdownField
				options={MODES}
				value={mode}
				onchange={(next) => {
					if (next === 'HEX' || next === 'RGB' || next === 'HSL' || next === 'HSB') mode = next;
				}}
			/>
			{#if mode === 'HEX'}
				<div class="flex min-w-0 items-center gap-1">
					<div
						class="border-line bg-raised focus-within:border-line-strong flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded border px-1"
					>
						<span
							class="border-line size-3.5 shrink-0 rounded-sm border"
							style:background={previewBackground}
							data-color-preview
						></span>
						<input
							aria-label="Hex"
							class="text-default h-full min-w-0 flex-1 bg-transparent text-xs uppercase tabular-nums outline-none"
							value={hexDraft === null ? hexText : hexDraft}
							oninput={(event) => onHexInput(event.currentTarget.value)}
							onblur={commitHex}
							onkeydown={onHexKey}
						/>
					</div>
					<div class="w-16 shrink-0">
						<NumberField
							label="%"
							name="Alpha"
							min={0}
							max={100}
							value={Math.round(color.a * 10000) / 100}
							onchange={(value, gesture) => onchange({ ...color, a: value / 100 }, gesture)}
						/>
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-3 gap-1">
					{#each numericFields as field, index (field.name)}
						<NumberField
							label={field.label}
							name={field.name}
							min={0}
							max={field.max}
							precision={0}
							value={field.value}
							onchange={(value) => setNumeric(index, value)}
						/>
					{/each}
				</div>
			{/if}
		</div>

		{#each [{ title: 'Document colors', colors: documentColors }, { title: 'Recent', colors: recentColors }] as group (group.title)}
			{#if group.colors.length > 0}
				<div class="flex flex-col gap-1" data-color-group={group.title}>
					<span class="text-faint text-xs">{group.title}</span>
					<div class="flex flex-wrap gap-1">
						{#each group.colors as swatch, index (index)}
							<button
								type="button"
								aria-label="Use {rgbToHex(swatch)}"
								class="border-line size-5 rounded border"
								style:background={swatchStyle(swatch)}
								onclick={() => emitRgba(swatch, 'commit')}
							></button>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	{:else}
		<div class="flex max-h-56 flex-col gap-0.5 overflow-y-auto" data-variable-list>
			{#if variables.length === 0}
				<span class="text-faint py-4 text-center text-xs">No colour variables</span>
			{/if}
			{#each variables as variable (variable.id)}
				<button
					type="button"
					class={[
						'hover:bg-hover flex items-center gap-2 rounded px-1 py-1 text-left text-xs',
						boundVariableId === variable.id && 'bg-raised'
					]}
					onclick={() => onbind?.(boundVariableId === variable.id ? null : variable.id)}
				>
					<span
						class="border-line size-4 shrink-0 rounded border"
						style:background={swatchStyle(variable.color)}
					></span>
					<span class="text-default truncate">{variable.name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
