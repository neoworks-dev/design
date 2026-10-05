<script lang="ts">
	import { switchInstanceVariant } from '../../lib/components/variants';
	import { variantPropertyNames, variantValues } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';

	// The Design tab section of an instance of a variant: one dropdown per variant property.
	// Switching swaps the instance's subtree for the matching variant and carries its overrides
	// over by name path (data-model.md section 2).
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
	const set = $derived(
		instance === undefined ? undefined : ctx.componentSync.variantSetOf(instance.mainComponentId)
	);
	const names = $derived.by(() => {
		if (set === undefined) return [];
		return variantPropertyNames(set);
	});

	function options(key: string): { value: string; label: string }[] {
		if (set === undefined) return [];
		return variantValues(ctx.document.reader, set.id, key).map((value) => ({
			value,
			label: value
		}));
	}

	function valueOf(key: string): string {
		const entry = instance?.componentProperties[key];
		if (entry === undefined) return '';
		return String(entry.value);
	}
</script>

{#if instance !== undefined && set !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-instance-variants>
		{#each names as key (key)}
			<div class="flex items-center gap-2 text-xs" data-instance-variant={key}>
				<span class="text-muted w-20 shrink-0 truncate">{key}</span>
				<div class="min-w-0 flex-1">
					<DropdownField
						options={options(key)}
						value={valueOf(key)}
						onchange={(value) => switchInstanceVariant(ctx, instance.id, key, value)}
					/>
				</div>
			</div>
		{/each}
	</div>
{/if}
