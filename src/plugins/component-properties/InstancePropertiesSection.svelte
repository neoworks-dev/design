<script lang="ts">
	import { setInstanceValue } from '../../lib/components/properties';
	import { definitionsOf } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';

	// The Design tab section of an instance: a control per boolean, text and instance-swap
	// property of its main component. Changing one updates the layers bound to it, in one undo
	// step. Variant properties are the dropdowns of the variants plugin.
	const ctx = getKernel();

	const instance = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		const node = ctx.document.get(id);
		if (node === undefined || node.type !== 'INSTANCE' || node.componentRef !== undefined) {
			return undefined;
		}
		return node;
	});
	const entries = $derived.by(() => {
		if (instance === undefined) return [];
		return Object.entries(definitionsOf(ctx.document.reader, instance.mainComponentId)).filter(
			([key, definition]) =>
				definition.type !== 'VARIANT' && instance.componentProperties[key] !== undefined
		);
	});
	const components = $derived(
		ctx.componentSync
			.components()
			.filter((component) => component.id !== instance?.mainComponentId)
			.map((component) => ({
				value: component.id,
				label:
					component.setName === null ? component.name : `${component.setName} / ${component.name}`
			}))
	);

	function valueOf(key: string): boolean | string {
		const entry = instance?.componentProperties[key];
		if (entry === undefined) return '';
		return entry.value;
	}
</script>

{#if instance !== undefined && entries.length > 0}
	<div class="flex flex-col gap-2 px-3 pb-3" data-instance-properties>
		{#each entries as [key, definition] (key)}
			<div class="flex items-center gap-2 text-xs" data-instance-property={key}>
				<span class="text-muted w-20 shrink-0 truncate" title={key}>{key}</span>
				<div class="min-w-0 flex-1">
					{#if definition.type === 'BOOLEAN'}
						<input
							aria-label={key}
							type="checkbox"
							checked={valueOf(key) === true}
							onchange={(event) =>
								setInstanceValue(ctx, instance.id, key, event.currentTarget.checked)}
						/>
					{:else if definition.type === 'TEXT'}
						<input
							aria-label={key}
							class="bg-input border-line text-default w-full rounded-sm border px-2 py-1 text-xs outline-none"
							value={String(valueOf(key))}
							onchange={(event) =>
								setInstanceValue(ctx, instance.id, key, event.currentTarget.value)}
						/>
					{:else}
						<DropdownField
							options={components}
							value={String(valueOf(key))}
							onchange={(value) => setInstanceValue(ctx, instance.id, key, value)}
						/>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
