<script lang="ts">
	import { BLEND_MODES, type BlendMode, type Effect, type RGBA } from '../../lib/document';
	import { blendModeLabel, isShadow } from '../../lib/editing/effects';
	import { getKernel } from '../../lib/kernel/context';
	import { rgbaCss, rgbToHex } from '../../lib/ui/colorMath';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import Popover from '../../lib/ui/Popover.svelte';

	let {
		anchor,
		effect,
		stored,
		onedit,
		onclose
	}: {
		anchor: { x: number; y: number; width: number; height: number };
		/** The effect with variables resolved. */
		effect: Effect;
		/** The effect as stored, to tell which properties are bound. */
		stored: Effect;
		onedit: (change: (effect: Effect) => Effect, label: string, gesture: NumberGesture) => void;
		onclose: () => void;
	} = $props();

	const ctx = getKernel();
	const BLEND_OPTIONS = BLEND_MODES.map((mode) => ({ value: mode, label: blendModeLabel(mode) }));
	const CHECKER = 'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px';

	function boundName(property: string): string | undefined {
		const alias = stored.boundVariables?.[property];
		if (alias === undefined || Array.isArray(alias)) return undefined;
		const variable = ctx.variables.variable(alias.id);
		if (variable === undefined) return alias.id;
		return variable.name;
	}

	function setNumber(property: 'radius' | 'spread', value: number, gesture: NumberGesture): void {
		onedit((current) => ({ ...current, [property]: value }), `Change effect ${property}`, gesture);
	}

	function setOffset(axis: 'x' | 'y', value: number, gesture: NumberGesture): void {
		onedit(
			(current) => {
				if (!isShadow(current)) return current;
				return { ...current, offset: { ...current.offset, [axis]: value } };
			},
			'Change shadow offset',
			gesture
		);
	}

	function setColor(color: RGBA, gesture: NumberGesture): void {
		onedit(
			(current) => {
				if (!isShadow(current)) return current;
				const { boundVariables, ...rest } = current;
				if (boundVariables === undefined) return { ...rest, color };
				const { color: _unbound, ...others } = boundVariables;
				return { ...rest, color, boundVariables: others };
			},
			'Change shadow colour',
			gesture
		);
	}

	function openColor(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement) || !isShadow(effect)) return;
		const box = event.currentTarget.getBoundingClientRect();
		ctx.colorPicker.open({
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
			label: 'Shadow colour',
			scope: 'EFFECT',
			color: () => {
				if (!isShadow(effect)) return { r: 0, g: 0, b: 0, a: 1 };
				return effect.color;
			},
			onchange: setColor
		});
	}
</script>

<Popover {anchor} label="Effect settings" {onclose}>
	<div class="flex flex-col gap-2 p-3" data-effect-settings>
		{#if isShadow(effect)}
			<div class="grid grid-cols-2 gap-2">
				<NumberField
					label="X"
					name="Shadow X"
					value={effect.offset.x}
					onchange={(value, gesture) => setOffset('x', value, gesture)}
				/>
				<NumberField
					label="Y"
					name="Shadow Y"
					value={effect.offset.y}
					onchange={(value, gesture) => setOffset('y', value, gesture)}
				/>
				<NumberField
					label="B"
					name="Shadow blur"
					min={0}
					value={effect.radius}
					boundTo={boundName('radius')}
					disabled={boundName('radius') !== undefined}
					onchange={(value, gesture) => setNumber('radius', value, gesture)}
				/>
				<NumberField
					label="S"
					name="Shadow spread"
					value={effect.spread}
					boundTo={boundName('spread')}
					disabled={boundName('spread') !== undefined}
					onchange={(value, gesture) => setNumber('spread', value, gesture)}
				/>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					aria-label="Shadow colour"
					class="border-line size-6 shrink-0 overflow-hidden rounded border"
					style:background="linear-gradient({rgbaCss(effect.color, effect.color.a)}, {rgbaCss(
						effect.color,
						effect.color.a
					)}), {CHECKER}"
					onclick={openColor}
				></button>
				<span class="text-default text-xs uppercase tabular-nums">
					{boundName('color') === undefined ? rgbToHex(effect.color) : boundName('color')}
				</span>
				<div class="ml-auto w-16">
					<NumberField
						label="%"
						name="Shadow opacity"
						min={0}
						max={100}
						precision={0}
						value={Math.round(effect.color.a * 100)}
						onchange={(value, gesture) => setColor({ ...effect.color, a: value / 100 }, gesture)}
					/>
				</div>
			</div>
			<div data-effect-blend>
				<DropdownField
					options={BLEND_OPTIONS}
					value={effect.blendMode}
					onchange={(mode) =>
						onedit(
							(current) => {
								if (!isShadow(current)) return current;
								return { ...current, blendMode: mode as BlendMode };
							},
							'Change shadow blend mode',
							'commit'
						)}
				/>
			</div>
			{#if effect.type === 'DROP_SHADOW'}
				<label class="text-default flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						aria-label="Show behind node"
						checked={effect.showShadowBehindNode === true}
						onchange={(event) => {
							const checked = event.currentTarget.checked;
							onedit(
								(current) => {
									if (!isShadow(current)) return current;
									return { ...current, showShadowBehindNode: checked };
								},
								'Change show behind node',
								'commit'
							);
						}}
					/>
					Show behind node
				</label>
			{/if}
		{:else}
			<NumberField
				label="B"
				name="Blur"
				min={0}
				value={effect.radius}
				boundTo={boundName('radius')}
				disabled={boundName('radius') !== undefined}
				onchange={(value, gesture) => setNumber('radius', value, gesture)}
			/>
		{/if}
	</div>
</Popover>
