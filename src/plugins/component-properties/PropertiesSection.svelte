<script lang="ts">
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { deleteProperty, renameProperty, setDefaultValue } from '../../lib/components/properties';
	import { definitionsOf, variantsOf, type ComponentPropertyDefinition } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import CreatePropertyPopover from './CreatePropertyPopover.svelte';

	// The Design tab section of a main component (or of a component set): its boolean, text and
	// instance-swap properties with their default values, and the "Create property" dialog.
	// Variant properties are edited in the variants sections.
	const ctx = getKernel();

	const TYPE_LABELS: Record<string, string> = {
		BOOLEAN: 'Boolean',
		TEXT: 'Text',
		INSTANCE_SWAP: 'Instance'
	};

	/** The main whose definitions are shown: the selected component, or a set's first variant. */
	const mainId = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		const node = ctx.document.get(id);
		if (node === undefined) return undefined;
		if (node.type === 'COMPONENT') return node.id;
		if (node.type !== 'COMPONENT_SET') return undefined;
		return variantsOf(ctx.document.reader, node.id)[0]?.id;
	});
	const entries = $derived.by((): [string, ComponentPropertyDefinition][] => {
		if (mainId === undefined) return [];
		return Object.entries(definitionsOf(ctx.document.reader, mainId)).filter(
			([, definition]) => definition.type !== 'VARIANT'
		);
	});
	const components = $derived(
		ctx.componentSync.components().map((component) => ({
			value: component.id,
			label:
				component.setName === null ? component.name : `${component.setName} / ${component.name}`
		}))
	);

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function openCreate(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		anchor = { x: box.left, y: box.top, width: box.width, height: box.height };
	}

	function rename(event: Event, key: string): void {
		if (mainId === undefined || !(event.currentTarget instanceof HTMLInputElement)) return;
		const name = event.currentTarget.value.trim();
		if (name === '' || name === key) {
			event.currentTarget.value = key;
			return;
		}
		renameProperty(ctx, mainId, key, name);
	}

	function changeText(event: Event, key: string): void {
		if (mainId === undefined || !(event.currentTarget instanceof HTMLInputElement)) return;
		setDefaultValue(ctx, mainId, key, event.currentTarget.value);
	}

	function changeBoolean(event: Event, key: string): void {
		if (mainId === undefined || !(event.currentTarget instanceof HTMLInputElement)) return;
		setDefaultValue(ctx, mainId, key, event.currentTarget.checked);
	}
</script>

{#if mainId !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-component-properties>
		<div class="flex items-center justify-between text-xs">
			<span class="text-muted">Properties</span>
			<IconToggleButton icon={PlusIcon} label="Create property" onclick={openCreate} />
		</div>
		{#each entries as [key, definition] (key)}
			<div class="flex flex-col gap-1" data-component-property={key}>
				<div class="flex items-center gap-1">
					<input
						aria-label="Property {key}"
						class="bg-input border-line text-default min-w-0 flex-1 rounded-sm border px-2 py-1 text-xs outline-none"
						value={key}
						onchange={(event) => rename(event, key)}
					/>
					<span class="text-faint w-14 shrink-0 text-right text-xs">
						{TYPE_LABELS[definition.type]}
					</span>
					<IconToggleButton
						icon={MinusIcon}
						label="Delete property {key}"
						onclick={() => deleteProperty(ctx, mainId, key)}
					/>
				</div>
				{#if definition.type === 'BOOLEAN'}
					<label class="text-muted flex items-center gap-2 text-xs">
						<input
							aria-label="Default of {key}"
							type="checkbox"
							checked={definition.defaultValue === true}
							onchange={(event) => changeBoolean(event, key)}
						/>
						Default {definition.defaultValue === true ? 'on' : 'off'}
					</label>
				{:else if definition.type === 'TEXT'}
					<input
						aria-label="Default of {key}"
						class="bg-input border-line text-default rounded-sm border px-2 py-1 text-xs outline-none"
						value={String(definition.defaultValue)}
						onchange={(event) => changeText(event, key)}
					/>
				{:else}
					<DropdownField
						options={components}
						value={String(definition.defaultValue)}
						onchange={(value) => setDefaultValue(ctx, mainId, key, value)}
					/>
				{/if}
			</div>
		{:else}
			<p class="text-faint text-xs">No properties yet</p>
		{/each}
	</div>
{/if}

{#if anchor !== null && mainId !== undefined}
	<CreatePropertyPopover {anchor} {mainId} onclose={() => (anchor = null)} />
{/if}
