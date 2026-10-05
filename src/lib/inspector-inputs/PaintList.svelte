<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import type { NodeId, Paint } from '../document';
	import {
		convertPaint,
		paintCss,
		PAINT_KIND_LABELS,
		removeAt,
		reorder,
		replaceAt,
		withBoundColor,
		withSolidColor,
		type PaintKind
	} from '../editing/paints';
	import { getKernel } from '../kernel/context';
	import { startRowDrag } from './rowReorder';
	import { parseHex, rgbToHex } from '../ui/colorMath';
	import Popover from '../ui/Popover.svelte';
	import IconToggleButton from '../ui/IconToggleButton.svelte';
	import type { NumberGesture } from '../ui/numberField';

	// One list of paints, used for fills and for strokes. It renders `paints` (variables already
	// resolved) and reports every edit as an `update` of a node's own paint list, so a selection
	// whose nodes differ elsewhere still edits cleanly. Rows are listed top paint first, the way
	// the canvas stacks them: the last paint of the array is on top.
	let {
		role,
		paints,
		stored,
		nodeId,
		mixed = false,
		onedit
	}: {
		role: 'fill' | 'stroke';
		/** Resolved paints, bottom to top. */
		paints: Paint[];
		/** The paints as stored (bound variables intact), bottom to top. */
		stored: Paint[];
		/** The node whose box the gradient handles sit on. */
		nodeId: NodeId;
		/** The selected nodes have different paints. */
		mixed?: boolean;
		onedit: (update: (paints: Paint[]) => Paint[], gesture: NumberGesture, label: string) => void;
	} = $props();

	const ctx = getKernel();
	const noun = $derived(role === 'fill' ? 'Fill' : 'Stroke');
	const scope = $derived(role === 'fill' ? 'FILL' : 'STROKE');

	const KINDS: PaintKind[] = [
		'SOLID',
		'GRADIENT_LINEAR',
		'GRADIENT_RADIAL',
		'GRADIENT_ANGULAR',
		'GRADIENT_DIAMOND'
	];
	const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind, label: PAINT_KIND_LABELS[kind] }));
	const IMAGE_OPTIONS = [...KIND_OPTIONS, { value: 'IMAGE', label: 'Image' }];

	const rows = $derived(paints.map((paint, index) => ({ paint, index })).reverse());

	let hexDrafts = $state<Record<number, string>>({});
	let opacityDrafts = $state<Record<number, string>>({});
	let typeMenu = $state<{ index: number; anchor: DOMRect } | null>(null);
	let list = $state<HTMLElement>();

	function boundName(index: number): string | undefined {
		const paint = stored[index];
		if (paint === undefined || paint.type !== 'SOLID') return undefined;
		const alias = paint.boundVariables?.color;
		if (alias === undefined || Array.isArray(alias)) return undefined;
		const variable = ctx.variables.variable(alias.id);
		if (variable === undefined) return alias.id;
		return variable.name;
	}

	function anchorOf(event: Event): { x: number; y: number; width: number; height: number } | null {
		if (!(event.currentTarget instanceof HTMLElement)) return null;
		const box = event.currentTarget.getBoundingClientRect();
		return { x: box.left, y: box.top, width: box.width, height: box.height };
	}

	function edit(update: (paints: Paint[]) => Paint[], label: string, gesture: NumberGesture): void {
		onedit(update, gesture, label);
	}

	function editPaint(
		index: number,
		change: (paint: Paint) => Paint,
		label: string,
		gesture: NumberGesture = 'commit'
	): void {
		edit(
			(current) => {
				const paint = current[index];
				if (paint === undefined) return current;
				return replaceAt(current, index, change(paint));
			},
			label,
			gesture
		);
	}

	// ---------- opening editors ----------

	function openColor(event: Event, index: number): void {
		const anchor = anchorOf(event);
		if (anchor === null) return;
		const paint = paints[index];
		if (paint.type === 'IMAGE') return;
		if (paint.type !== 'SOLID') {
			ctx.gradientEditor.open({
				anchor,
				nodeId,
				label: `${noun} gradient`,
				paint: () => {
					const current = stored[index];
					if (current === undefined || current.type === 'SOLID' || current.type === 'IMAGE') {
						return undefined;
					}
					return current;
				},
				onchange: (next, gesture) => editPaint(index, () => next, `Edit ${role} gradient`, gesture)
			});
			return;
		}
		openSolid(anchor, index);
	}

	/** Unbinding keeps the colour the variable resolved to, as `variables.unbindPaintColor` does. */
	function unboundPaint(index: number, current: Paint): Paint {
		const resolved = paints[index];
		if (current.type !== 'SOLID' || resolved.type !== 'SOLID') return current;
		return {
			...withBoundColor(current, null),
			color: resolved.color,
			opacity: resolved.opacity
		};
	}

	function openSolid(
		anchor: { x: number; y: number; width: number; height: number },
		index: number
	): void {
		ctx.colorPicker.open({
			anchor,
			label: `${noun} colour`,
			scope,
			color: () => {
				const current = paints[index];
				if (current === undefined || current.type !== 'SOLID') return { r: 0, g: 0, b: 0, a: 1 };
				return { ...current.color, a: current.opacity };
			},
			onchange: (color, gesture) =>
				editPaint(
					index,
					(paint) => (paint.type === 'SOLID' ? withSolidColor(paint, color) : paint),
					`Change ${role} colour`,
					gesture
				),
			variableId: () => {
				const paint = stored[index];
				if (paint === undefined || paint.type !== 'SOLID') return undefined;
				const alias = paint.boundVariables?.color;
				if (alias === undefined || Array.isArray(alias)) return undefined;
				return alias.id;
			},
			onbind: (variableId) =>
				editPaint(
					index,
					(paint) => {
						if (paint.type !== 'SOLID') return paint;
						if (variableId === null) return unboundPaint(index, paint);
						return withBoundColor(paint, variableId);
					},
					`Bind ${role} colour`
				)
		});
	}

	// ---------- row actions ----------

	function setKind(index: number, kind: string): void {
		editPaint(index, (paint) => convertPaint(paint, kind as PaintKind), `Change ${role} type`);
	}

	function commitHex(index: number): void {
		const text = hexDrafts[index];
		if (text === undefined) return;
		const rest = { ...hexDrafts };
		delete rest[index];
		hexDrafts = rest;
		const parsed = parseHex(text);
		if (parsed === undefined) return;
		editPaint(
			index,
			(paint) => {
				if (paint.type !== 'SOLID') return paint;
				return withSolidColor(paint, { ...parsed, a: paint.opacity });
			},
			`Change ${role} colour`
		);
	}

	function applyOpacity(index: number, percent: number): void {
		const clamped = Math.min(100, Math.max(0, Math.round(percent)));
		editPaint(index, (paint) => ({ ...paint, opacity: clamped / 100 }), `Change ${role} opacity`);
	}

	function commitOpacity(index: number): void {
		const text = opacityDrafts[index];
		if (text === undefined) return;
		const rest = { ...opacityDrafts };
		delete rest[index];
		opacityDrafts = rest;
		const parsed = Number.parseFloat(text.replace('%', ''));
		if (Number.isNaN(parsed)) return;
		applyOpacity(index, parsed);
	}

	function onOpacityKey(event: KeyboardEvent, index: number): void {
		if (event.key === 'Enter') {
			commitOpacity(index);
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		let amount = 1;
		if (event.shiftKey) amount = 10;
		if (event.key === 'ArrowDown') amount = -amount;
		applyOpacity(index, Math.round(paints[index].opacity * 100) + amount);
	}

	function openTypeMenu(event: MouseEvent, index: number): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		typeMenu = { index, anchor: event.currentTarget.getBoundingClientRect() };
	}

	function chooseKind(kind: string): void {
		if (typeMenu === null) return;
		setKind(typeMenu.index, kind);
		typeMenu = null;
	}

	const typeMenuPaint = $derived.by(() => {
		if (typeMenu === null) return undefined;
		return paints[typeMenu.index];
	});
	const typeMenuCurrent = $derived.by(() => {
		if (typeMenuPaint === undefined) return undefined;
		return typeMenuPaint.type;
	});
	const typeOptions = $derived.by(() => {
		if (typeMenuCurrent === 'IMAGE') return IMAGE_OPTIONS;
		return KIND_OPTIONS;
	});

	function hexOf(index: number): string {
		const paint = paints[index];
		if (paint.type !== 'SOLID') return '';
		return rgbToHex(paint.color);
	}

	function move(from: number, to: number): void {
		edit((current) => reorder(current, from, to), `Reorder ${role}s`, 'commit');
	}

	function onGripKey(event: KeyboardEvent, index: number): void {
		// Rows run top first, so ArrowUp moves a paint up the stack: later in the array.
		if (event.key === 'ArrowUp') move(index, index + 1);
		else if (event.key === 'ArrowDown') move(index, index - 1);
		else return;
		event.preventDefault();
	}

	function onGripDown(event: PointerEvent, index: number): void {
		if (list === undefined) return;
		startRowDrag(event, list, 'data-paint-row', index, move);
	}
</script>

{#if mixed || rows.length > 0}
	<div class="flex flex-col gap-1.5 px-3 pb-3" data-paint-list={role} bind:this={list}>
		{#if mixed}
			<span class="text-muted text-xs" data-paint-mixed>Mixed</span>
		{:else}
			{#each rows as row (row.index)}
				{@const paint = row.paint}
				{@const name = boundName(row.index)}
				<div class="group relative flex items-center gap-0.5" data-paint-row={row.index}>
					<button
						type="button"
						aria-label="Reorder {role} {row.index + 1}"
						title="Drag, or press Up / Down, to reorder"
						class="text-faint hover:text-default absolute top-1/2 -left-3 flex h-6 w-3 -translate-y-1/2 cursor-grab items-center justify-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
						onpointerdown={(event) => onGripDown(event, row.index)}
						onkeydown={(event) => onGripKey(event, row.index)}
					>
						<DotsSixVerticalIcon size={12} />
					</button>
					<div
						class="border-line bg-raised focus-within:border-action flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border pl-1.5"
					>
						<button
							type="button"
							aria-label="Edit {role} {row.index + 1}"
							class="border-line size-4 shrink-0 cursor-pointer overflow-hidden rounded-sm border"
							style:background={paintCss(paint)}
							data-paint-swatch
							onclick={(event) => openColor(event, row.index)}
						></button>
						{#if paint.type === 'SOLID' && name !== undefined}
							<button
								type="button"
								class="text-default flex h-full min-w-0 flex-1 items-center truncate text-left text-xs"
								title="Unbind variable {name}"
								data-bound-chip
								onclick={() =>
									editPaint(
										row.index,
										(current) => unboundPaint(row.index, current),
										`Unbind ${role} variable`
									)}
							>
								<span class="truncate">{name}</span>
							</button>
						{:else if paint.type === 'SOLID'}
							<input
								aria-label="{noun} {row.index + 1} hex"
								class="text-default h-full min-w-0 flex-1 bg-transparent text-xs uppercase tabular-nums outline-none"
								value={hexDrafts[row.index] === undefined ? hexOf(row.index) : hexDrafts[row.index]}
								oninput={(event) =>
									(hexDrafts = { ...hexDrafts, [row.index]: event.currentTarget.value })}
								onblur={() => commitHex(row.index)}
								onkeydown={(event) => {
									if (event.key === 'Enter') commitHex(row.index);
								}}
							/>
						{:else}
							<span class="text-default min-w-0 flex-1 truncate text-xs" data-paint-kind>
								{PAINT_KIND_LABELS[paint.type]}
							</span>
						{/if}
						<button
							type="button"
							aria-label="{noun} {row.index + 1} type"
							title="Change type"
							class={[
								'text-muted hover:text-default flex h-full w-4 shrink-0 items-center justify-center',
								paint.type === 'SOLID' &&
									'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
							]}
							data-paint-type-button
							onclick={(event) => openTypeMenu(event, row.index)}
						>
							<CaretDownIcon size={10} />
						</button>
						<span class="bg-line h-3.5 w-px shrink-0"></span>
						<div class="flex w-12 shrink-0 items-center pr-1.5 text-xs">
							<input
								aria-label="{noun} {row.index + 1} opacity"
								inputmode="numeric"
								class="text-default h-full min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
								value={opacityDrafts[row.index] === undefined
									? String(Math.round(paint.opacity * 100))
									: opacityDrafts[row.index]}
								oninput={(event) =>
									(opacityDrafts = { ...opacityDrafts, [row.index]: event.currentTarget.value })}
								onblur={() => commitOpacity(row.index)}
								onkeydown={(event) => onOpacityKey(event, row.index)}
							/>
							<span class="text-faint pl-0.5 select-none">%</span>
						</div>
					</div>
					<IconToggleButton
						icon={paint.visible ? EyeIcon : EyeSlashIcon}
						label="Toggle {role} {row.index + 1} visibility"
						pressed={paint.visible}
						onclick={() =>
							editPaint(
								row.index,
								(current) => ({ ...current, visible: !current.visible }),
								`Toggle ${role} visibility`
							)}
					/>
					<IconToggleButton
						icon={MinusIcon}
						label="Remove {role} {row.index + 1}"
						onclick={() =>
							edit((current) => removeAt(current, row.index), `Remove ${role}`, 'commit')}
					/>
				</div>
			{/each}
		{/if}
	</div>
{/if}

{#if typeMenu !== null}
	<Popover
		anchor={typeMenu.anchor}
		label="{noun} type"
		width={140}
		onclose={() => (typeMenu = null)}
	>
		<div class="flex flex-col p-1 text-xs" data-paint-type-menu>
			{#each typeOptions as option (option.value)}
				<button
					type="button"
					class={[
						'hover:bg-hover rounded px-2 py-1 text-left',
						option.value === typeMenuCurrent && 'bg-raised'
					]}
					data-paint-type-option={option.value}
					onclick={() => chooseKind(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</Popover>
{/if}
