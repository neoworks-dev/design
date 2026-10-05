<script lang="ts">
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import type { GradientPaint, RGBA } from '../../lib/document';
	import {
		addStop,
		moveStop,
		removeStop,
		reverseStops,
		rotateGradient,
		stopsCss,
		type GradientType
	} from '../../lib/editing/gradient';
	import { getKernel } from '../../lib/kernel/context';
	import { rgbaCss, rgbToHex } from '../../lib/ui/colorMath';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import Popover from '../../lib/ui/Popover.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const ctx = getKernel();
	const editor = ctx.gradientEditor;
	const request = $derived(editor.state.current);
	const paint = $derived(editor.paint);

	const TYPES = [
		{ value: 'GRADIENT_LINEAR', label: 'Linear' },
		{ value: 'GRADIENT_RADIAL', label: 'Radial' },
		{ value: 'GRADIENT_ANGULAR', label: 'Angular' },
		{ value: 'GRADIENT_DIAMOND', label: 'Diamond' }
	];
	const CHECKER = 'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px';

	const selectedIndex = $derived.by(() => {
		if (paint === undefined) return 0;
		return Math.min(editor.state.selectedStop, paint.gradientStops.length - 1);
	});
	const selectedStop = $derived(paint?.gradientStops[selectedIndex]);

	// The paint disappeared (undo, delete): nothing left to edit.
	$effect(() => {
		if (request !== null && paint === undefined) editor.close();
	});

	function setType(type: string): void {
		editor.edit((current) => ({ ...current, type: type as GradientType }), 'commit');
	}

	function setStopColor(index: number, color: RGBA, gesture: NumberGesture): void {
		editor.edit((current) => {
			const stops = current.gradientStops.map((stop, at) => {
				if (at !== index) return stop;
				const { boundVariables: _unbound, ...rest } = stop;
				return { ...rest, color };
			});
			return { ...current, gradientStops: stops };
		}, gesture);
	}

	function bindStop(index: number, variableId: string | null): void {
		editor.edit((current) => {
			const stops = current.gradientStops.map((stop, at) => {
				if (at !== index) return stop;
				if (variableId === null) {
					const { boundVariables: _unbound, ...rest } = stop;
					return rest;
				}
				return {
					...stop,
					boundVariables: { color: { type: 'VARIABLE_ALIAS' as const, id: variableId } }
				};
			});
			return { ...current, gradientStops: stops };
		}, 'commit');
	}

	function setStopPosition(index: number, percent: number, gesture: NumberGesture): void {
		editor.edit(
			(current) => ({
				...current,
				gradientStops: moveStop(current.gradientStops, index, percent / 100)
			}),
			gesture
		);
	}

	function openStopColor(event: MouseEvent, index: number): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		const stopAt = (): RGBA => {
			const stop = editor.paint?.gradientStops[index];
			if (stop === undefined) return { r: 0, g: 0, b: 0, a: 1 };
			return stop.color;
		};
		ctx.colorPicker.open({
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
			label: 'Stop colour',
			scope: 'FILL',
			color: stopAt,
			onchange: (color, gesture) => setStopColor(index, color, gesture),
			variableId: () => {
				const bound = editor.paint?.gradientStops[index]?.boundVariables?.color;
				if (bound === undefined || Array.isArray(bound)) return undefined;
				return bound.id;
			},
			onbind: (variableId) => bindStop(index, variableId)
		});
	}

	// ---------- stops bar ----------

	let bar = $state<HTMLElement>();

	function fractionAt(event: PointerEvent): number {
		if (bar === undefined) return 0;
		const box = bar.getBoundingClientRect();
		return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
	}

	function addStopAt(event: PointerEvent): void {
		if (event.target !== bar) return;
		const position = fractionAt(event);
		let created = -1;
		editor.edit((current) => {
			const added = addStop(current.gradientStops, position);
			created = added.index;
			return { ...current, gradientStops: added.stops };
		}, 'commit');
		if (created >= 0) editor.selectStop(created);
	}

	function dragStop(event: PointerEvent, index: number): void {
		event.stopPropagation();
		editor.selectStop(index);
		const element = event.currentTarget;
		if (!(element instanceof HTMLElement)) return;
		element.setPointerCapture(event.pointerId);
		const move = (moveEvent: PointerEvent): void => {
			editor.edit(
				(current) => ({
					...current,
					gradientStops: moveStop(current.gradientStops, index, fractionAt(moveEvent))
				}),
				'scrub'
			);
		};
		const finish = (): void => {
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerup', finish);
		};
		element.addEventListener('pointermove', move);
		element.addEventListener('pointerup', finish);
	}

	function removeSelected(): void {
		editor.edit(
			(current) => ({
				...current,
				gradientStops: removeStop(current.gradientStops, selectedIndex)
			}),
			'commit'
		);
		editor.selectStop(Math.max(0, selectedIndex - 1));
	}

	function reverse(): void {
		editor.edit(
			(current) => ({ ...current, gradientStops: reverseStops(current.gradientStops) }),
			'commit'
		);
	}

	function rotate(): void {
		editor.edit((current: GradientPaint) => {
			const node = ctx.document.get(request?.nodeId ?? '');
			if (node === undefined || !('width' in node)) return current;
			return rotateGradient(current, { width: node.width, height: node.height });
		}, 'commit');
	}
</script>

{#if request !== null && paint !== undefined}
	<Popover
		anchor={request.anchor}
		label={request.label}
		width={264}
		keepOpenOn={(target) => target.closest('[data-region="canvas"]') !== null}
		onclose={() => editor.close()}
	>
		<div class="flex flex-col gap-3 p-3" data-gradient-editor>
			<ToggleGroup name="Gradient type" options={TYPES} value={paint.type} onchange={setType} />

			<div class="flex flex-col gap-1">
				<div
					bind:this={bar}
					class="border-line relative h-6 cursor-copy rounded border"
					style:background="{stopsCss(paint.gradientStops)}, {CHECKER}"
					role="presentation"
					data-stops-bar
					onpointerdown={addStopAt}
				>
					{#each paint.gradientStops as stop, index (index)}
						<div
							role="button"
							tabindex="-1"
							aria-label="Stop {index + 1}"
							aria-pressed={index === selectedIndex}
							class={[
								'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 shadow',
								index === selectedIndex ? 'border-white ring-2 ring-[#0d99ff]' : 'border-white'
							]}
							style:left="{stop.position * 100}%"
							style:background={rgbaCss(stop.color, 1)}
							data-stop={index}
							onpointerdown={(event) => dragStop(event, index)}
						></div>
					{/each}
				</div>
			</div>

			{#if selectedStop}
				<div class="flex items-center gap-2" data-stop-row>
					<div class="w-16">
						<NumberField
							label="%"
							name="Stop position"
							min={0}
							max={100}
							value={Math.round(selectedStop.position * 10000) / 100}
							onchange={(value, gesture) => setStopPosition(selectedIndex, value, gesture)}
						/>
					</div>
					<button
						type="button"
						aria-label="Stop colour"
						class="border-line relative size-6 shrink-0 overflow-hidden rounded border"
						style:background="linear-gradient({rgbaCss(selectedStop.color, selectedStop.color.a)}, {rgbaCss(
							selectedStop.color,
							selectedStop.color.a
						)}), {CHECKER}"
						onclick={(event) => openStopColor(event, selectedIndex)}
					></button>
					<span class="text-default min-w-0 flex-1 truncate text-xs uppercase tabular-nums">
						{rgbToHex(selectedStop.color)}
					</span>
					<div class="w-16">
						<NumberField
							label="α"
							name="Stop opacity"
							min={0}
							max={100}
							value={Math.round(selectedStop.color.a * 100)}
							onchange={(value, gesture) =>
								setStopColor(selectedIndex, { ...selectedStop.color, a: value / 100 }, gesture)}
						/>
					</div>
					<IconToggleButton
						icon={TrashIcon}
						label="Remove stop"
						disabled={paint.gradientStops.length <= 2}
						onclick={removeSelected}
					/>
				</div>
			{/if}

			<div class="flex items-center gap-1">
				<IconToggleButton icon={ArrowsLeftRightIcon} label="Reverse stops" onclick={reverse} />
				<IconToggleButton icon={ArrowClockwiseIcon} label="Rotate 90 degrees" onclick={rotate} />
				<span class="text-faint ml-auto text-xs">Esc to finish</span>
			</div>
		</div>
	</Popover>
{/if}
