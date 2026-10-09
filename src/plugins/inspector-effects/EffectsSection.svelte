<script lang="ts">
	import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import SlidersIcon from 'phosphor-svelte/lib/SlidersIcon';
	import { planSetProps, type Effect, type Node } from '../../lib/document';
	import {
		convertEffect,
		EFFECT_LABELS,
		EFFECT_TYPES,
		type EffectType
	} from '../../lib/editing/effects';
	import { removeAt, reorder, replaceAt } from '../../lib/editing/paints';
	import { startRowDrag } from '../../lib/inspector-inputs/rowReorder';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import EffectSettings from './EffectSettings.svelte';

	const NO_EFFECTS: Effect[] = [];
	const TYPE_OPTIONS = EFFECT_TYPES.map((type) => ({ value: type, label: EFFECT_LABELS[type] }));

	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function effectsOf(node: Node): Effect[] {
		if (!('effects' in node)) return NO_EFFECTS;
		return node.effects;
	}

	const effects = $derived(sharedValue(nodes, effectsOf));
	const shown = $derived.by(() => {
		if (effects.value === null) return [];
		return effects.value;
	});
	const stored = $derived.by(() => {
		const [first] = nodes;
		if (first === undefined) return [];
		return effectsOf(ctx.document.require(first.id));
	});

	const hasRows = $derived(effects.mixed || shown.length > 0);

	let list = $state<HTMLElement>();
	let settings = $state<{ index: number; anchor: DOMRect } | null>(null);

	function editEffects(
		label: string,
		gesture: NumberGesture,
		change: (effects: Effect[]) => Effect[]
	): void {
		editSelection(
			ctx,
			{ label, mergeKey: `inspector:effects:${label}`, gesture },
			(reader, node) => {
				if (!('effects' in node)) return [];
				return planSetProps(reader, node.id, { effects: change(node.effects) });
			}
		);
	}

	function editEffect(
		index: number,
		change: (effect: Effect) => Effect,
		label: string,
		gesture: NumberGesture = 'commit'
	): void {
		editEffects(label, gesture, (current) => {
			const effect = current[index];
			if (effect === undefined) return current;
			return replaceAt(current, index, change(effect));
		});
	}

	function move(from: number, to: number): void {
		editEffects('Reorder effects', 'commit', (current) => reorder(current, from, to));
	}

	function onGripKey(event: KeyboardEvent, index: number): void {
		if (event.key === 'ArrowUp') move(index, index - 1);
		else if (event.key === 'ArrowDown') move(index, index + 1);
		else return;
		event.preventDefault();
	}

	function openSettings(event: MouseEvent, index: number): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		settings = { index, anchor: event.currentTarget.getBoundingClientRect() };
	}

	const settingsStored = $derived.by(() => {
		if (settings === null) return undefined;
		return stored[settings.index];
	});

	function editSettingsEffect(
		change: (effect: Effect) => Effect,
		label: string,
		gesture: NumberGesture
	): void {
		if (settings === null) return;
		editEffect(settings.index, change, label, gesture);
	}

	const settingsEffect = $derived.by(() => {
		if (settings === null) return undefined;
		return shown[settings.index];
	});
	$effect(() => {
		if (settings !== null && settingsEffect === undefined) settings = null;
	});
</script>

{#if nodes.length > 0}
	<div
		class={['flex flex-col gap-1.5', hasRows && 'px-4 pb-4']}
		data-effects-section
		bind:this={list}
	>
		{#if effects.mixed}
			<span class="text-muted text-xs" data-effects-mixed>Mixed</span>
		{/if}

		{#if !effects.mixed}
			{#each shown as effect, index (index)}
				<div class="group relative flex items-center gap-0.5" data-effect-row={index}>
					<button
						type="button"
						aria-label="Reorder effect {index + 1}"
						title="Drag, or press Up / Down, to reorder"
						class="text-faint hover:text-default absolute top-1/2 -left-3 flex h-6 w-3 -translate-y-1/2 cursor-grab items-center justify-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
						onpointerdown={(event) => {
							if (list !== undefined) startRowDrag(event, list, 'data-effect-row', index, move);
						}}
						onkeydown={(event) => onGripKey(event, index)}
					>
						<DotsSixVerticalIcon size={12} />
					</button>
					<div class="min-w-0 flex-1">
						<DropdownField
							options={TYPE_OPTIONS}
							value={effect.type}
							onchange={(type) =>
								editEffect(
									index,
									(current) => convertEffect(current, type as EffectType),
									'Change effect type'
								)}
						/>
					</div>
					<IconToggleButton
						compact
						icon={effect.visible ? EyeIcon : EyeSlashIcon}
						label="Toggle effect {index + 1} visibility"
						pressed={!effect.visible}
						onclick={() =>
							editEffect(
								index,
								(current) => ({ ...current, visible: !current.visible }),
								'Toggle effect visibility'
							)}
					/>
					<IconToggleButton
						compact
						icon={SlidersIcon}
						label="Effect {index + 1} settings"
						onclick={(event) => openSettings(event, index)}
					/>
					<IconToggleButton
						compact
						icon={MinusIcon}
						label="Remove effect {index + 1}"
						onclick={() =>
							editEffects('Remove effect', 'commit', (current) => removeAt(current, index))}
					/>
				</div>
			{/each}
		{/if}
	</div>
	{#if settings !== null && settingsEffect !== undefined && settingsStored !== undefined}
		<EffectSettings
			anchor={settings.anchor}
			effect={settingsEffect}
			stored={settingsStored}
			onedit={editSettingsEffect}
			onclose={() => (settings = null)}
		/>
	{/if}
{/if}
