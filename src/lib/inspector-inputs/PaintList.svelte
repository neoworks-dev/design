<script lang="ts">
	import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import HashIcon from 'phosphor-svelte/lib/HashIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import type { NodeId, Paint } from '../document';
	import {
		convertPaint,
		newPaint,
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
	import DropdownField from '../ui/DropdownField.svelte';
	import IconToggleButton from '../ui/IconToggleButton.svelte';
	import NumberField from '../ui/NumberField.svelte';
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

	function openVariables(event: Event, index: number): void {
		const anchor = anchorOf(event);
		if (anchor === null) return;
		if (paints[index].type !== 'SOLID') return;
		openSolid(anchor, index);
	}

	// ---------- row actions ----------

	function addPaint(): void {
		edit((current) => [...current, newPaint(role)], `Add ${role}`, 'commit');
	}

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

<div class="flex flex-col gap-2 px-3 pb-3" data-paint-list={role} bind:this={list}>
	<div class="flex items-center justify-between">
		{#if mixed}
			<span class="text-muted text-xs" data-paint-mixed>Mixed</span>
		{:else if paints.length === 0}
			<span class="text-faint text-xs">None</span>
		{:else}
			<span></span>
		{/if}
		<IconToggleButton icon={PlusIcon} label="Add {role}" onclick={addPaint} />
	</div>

	{#if !mixed}
		{#each rows as row (row.index)}
			{@const paint = row.paint}
			{@const name = boundName(row.index)}
			<div class="flex flex-col gap-1" data-paint-row={row.index}>
				<div class="flex items-center gap-1">
					<button
						type="button"
						aria-label="Reorder {role} {row.index + 1}"
						title="Drag, or press Up / Down, to reorder"
						class="text-faint hover:text-default flex h-6 w-3 cursor-grab items-center justify-center"
						onpointerdown={(event) => onGripDown(event, row.index)}
						onkeydown={(event) => onGripKey(event, row.index)}
					>
						<DotsSixVerticalIcon size={12} />
					</button>
					<button
						type="button"
						aria-label="Edit {role} {row.index + 1}"
						class="border-line size-6 shrink-0 cursor-pointer overflow-hidden rounded border"
						style:background={paintCss(paint)}
						data-paint-swatch
						onclick={(event) => openColor(event, row.index)}
					></button>
					<div class="min-w-0 flex-1">
						<DropdownField
							options={paint.type === 'IMAGE' ? IMAGE_OPTIONS : KIND_OPTIONS}
							value={paint.type}
							onchange={(kind) => setKind(row.index, kind)}
						/>
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
				<div class="flex items-center gap-1 pl-4">
					{#if paint.type === 'SOLID'}
						{#if name !== undefined}
							<button
								type="button"
								class="bg-raised text-default flex h-6 min-w-0 flex-1 items-center gap-1 truncate rounded px-1.5 text-xs"
								title="Unbind variable {name}"
								data-bound-chip
								onclick={() =>
									editPaint(
										row.index,
										(current) => unboundPaint(row.index, current),
										`Unbind ${role} variable`
									)}
							>
								<HashIcon size={12} />
								<span class="truncate">{name}</span>
							</button>
						{:else}
							<input
								aria-label="{noun} {row.index + 1} hex"
								class="border-line bg-raised text-default h-6 min-w-0 flex-1 rounded border px-1 text-xs uppercase tabular-nums"
								value={hexDrafts[row.index] === undefined ? hexOf(row.index) : hexDrafts[row.index]}
								oninput={(event) =>
									(hexDrafts = { ...hexDrafts, [row.index]: event.currentTarget.value })}
								onblur={() => commitHex(row.index)}
								onkeydown={(event) => {
									if (event.key === 'Enter') commitHex(row.index);
								}}
							/>
						{/if}
					{:else}
						<span class="text-muted min-w-0 flex-1 truncate text-xs">
							{PAINT_KIND_LABELS[paint.type]}
							{paint.type === 'IMAGE' ? '' : 'gradient'}
						</span>
					{/if}
					<div class="w-16">
						<NumberField
							label="%"
							name="{noun} {row.index + 1} opacity"
							min={0}
							max={100}
							precision={0}
							value={Math.round(paint.opacity * 100)}
							onchange={(value, gesture) =>
								editPaint(
									row.index,
									(current) => ({ ...current, opacity: value / 100 }),
									`Change ${role} opacity`,
									gesture
								)}
						/>
					</div>
					{#if paint.type === 'SOLID'}
						<IconToggleButton
							icon={HashIcon}
							label="Bind {role} {row.index + 1} to a variable"
							pressed={name !== undefined}
							onclick={(event) => openVariables(event, row.index)}
						/>
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</div>
