<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import {
		createProperty,
		initialValue,
		PROPERTY_TYPES,
		typeOfTarget,
		type CreatableType
	} from '../../lib/components/properties';
	import type { ComponentPropertyTarget } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import Popover from '../../lib/ui/Popover.svelte';

	// "Create property": name, type and default value. Opened from a main component, or from one of
	// its layers (then the new property is bound to that layer and takes its current value).
	let {
		anchor,
		mainId,
		layerId = undefined,
		target = undefined,
		onclose
	}: {
		anchor: { x: number; y: number; width: number; height: number };
		mainId: string;
		layerId?: string;
		target?: ComponentPropertyTarget;
		onclose: () => void;
	} = $props();

	const ctx = getKernel();

	// The form starts from the layer it was opened for and is then the user's: the props are read once.
	/* svelte-ignore state_referenced_locally */
	const startType: CreatableType = target === undefined ? 'BOOLEAN' : typeOfTarget(target);
	/* svelte-ignore state_referenced_locally */
	const layerName = layerId === undefined ? undefined : ctx.document.get(layerId)?.name;

	let name = $state(layerName ?? '');
	let type = $state<CreatableType>(startType);
	/* svelte-ignore state_referenced_locally */
	let value = $state<boolean | string>(initialValue(ctx, startType, layerId));

	const components = $derived(
		ctx.componentSync.components().map((component) => ({
			value: component.id,
			label:
				component.setName === null ? component.name : `${component.setName} / ${component.name}`
		}))
	);
	const bound = $derived(layerId !== undefined && target !== undefined);

	function setType(next: string): void {
		if (next !== 'BOOLEAN' && next !== 'TEXT' && next !== 'INSTANCE_SWAP') return;
		type = next;
		value = initialValue(ctx, next, bound ? layerId : undefined);
	}

	function create(): void {
		const trimmed = name.trim();
		if (trimmed === '') return;
		createProperty(ctx, mainId, {
			name: trimmed,
			type,
			defaultValue: value,
			layerIds: layerId === undefined ? undefined : [layerId]
		});
		onclose();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		create();
	}
</script>

<Popover {anchor} label="Create component property" width={260} {onclose}>
	<div class="flex flex-col gap-3 p-3" data-create-property>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-muted">Name</span>
			<input
				aria-label="Property name"
				class="bg-input border-line text-default rounded-sm border px-2 py-1 text-xs outline-none"
				bind:value={name}
				{onkeydown}
			/>
		</label>
		<div class="flex flex-col gap-1 text-xs">
			<span class="text-muted">Type</span>
			<DropdownField options={PROPERTY_TYPES} value={type} disabled={bound} onchange={setType} />
		</div>
		<div class="flex flex-col gap-1 text-xs">
			<span class="text-muted">Value</span>
			{#if type === 'BOOLEAN'}
				<label class="flex items-center gap-2">
					<input
						aria-label="Default value"
						type="checkbox"
						checked={value === true}
						onchange={(event) => (value = event.currentTarget.checked)}
					/>
					<span class="text-default">{value === true ? 'True' : 'False'}</span>
				</label>
			{:else if type === 'TEXT'}
				<input
					aria-label="Default value"
					class="bg-input border-line text-default rounded-sm border px-2 py-1 text-xs outline-none"
					value={String(value)}
					oninput={(event) => (value = event.currentTarget.value)}
					{onkeydown}
				/>
			{:else}
				<DropdownField
					options={components}
					value={typeof value === 'string' && value !== '' ? value : null}
					placeholder="Choose a component"
					onchange={(next) => (value = next)}
				/>
			{/if}
		</div>
		<div class="flex justify-end gap-2">
			<Button size="sm" onclick={onclose}>Cancel</Button>
			<Button size="sm" variant="primary" onclick={create}>Create property</Button>
		</div>
	</div>
</Popover>
