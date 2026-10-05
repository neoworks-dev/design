<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import {
		addVariant,
		addVariantProperty,
		deleteVariantProperty,
		renameVariantProperty
	} from '../../lib/components/variants';
	import { variantPropertyNames, variantValues } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	// The Design tab section of a component set: its variant properties (name and the values the
	// variants use), adding and removing properties, and adding a variant.
	const ctx = getKernel();

	const set = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		const node = ctx.document.get(id);
		if (node === undefined || node.type !== 'COMPONENT_SET') return undefined;
		return node;
	});
	const names = $derived.by(() => {
		if (set === undefined) return [];
		return variantPropertyNames(set);
	});

	function rename(event: Event, key: string): void {
		if (set === undefined || !(event.currentTarget instanceof HTMLInputElement)) return;
		const name = event.currentTarget.value.trim();
		if (name === '' || name === key) {
			event.currentTarget.value = key;
			return;
		}
		try {
			renameVariantProperty(ctx, set.id, key, name);
		} catch {
			event.currentTarget.value = key;
		}
	}
</script>

{#if set !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-variant-set-section>
		{#each names as key (key)}
			<div class="flex flex-col gap-1" data-variant-property={key}>
				<div class="flex items-center gap-1">
					<input
						aria-label="Property name {key}"
						class="bg-input border-line text-default min-w-0 flex-1 rounded-sm border px-2 py-1 text-xs outline-none"
						value={key}
						onchange={(event) => rename(event, key)}
					/>
					<IconToggleButton
						icon={MinusIcon}
						label="Delete property {key}"
						onclick={() => deleteVariantProperty(ctx, set.id, key)}
					/>
				</div>
				<span class="text-faint truncate text-xs" data-variant-values>
					{variantValues(ctx.document.reader, set.id, key).join(', ')}
				</span>
			</div>
		{/each}
		<div class="flex flex-wrap items-center gap-2">
			<Button size="sm" onclick={() => addVariantProperty(ctx, set.id)}>Add property</Button>
			<Button size="sm" onclick={() => addVariant(ctx, set.id)}>Add variant</Button>
		</div>
	</div>
{/if}
