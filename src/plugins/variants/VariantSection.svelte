<script lang="ts">
	import { setVariantValue } from '../../lib/components/variants';
	import { variantPropertyNames } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';

	// The Design tab section of a variant (a component inside a set): a value for each variant
	// property of the set.
	const ctx = getKernel();

	const variant = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		const node = ctx.document.get(id);
		if (node === undefined || node.type !== 'COMPONENT') return undefined;
		return node;
	});
	const set = $derived(
		variant === undefined ? undefined : ctx.componentSync.variantSetOf(variant.id)
	);
	const names = $derived.by(() => {
		if (set === undefined) return [];
		return variantPropertyNames(set);
	});

	function change(event: Event, key: string): void {
		if (variant === undefined || !(event.currentTarget instanceof HTMLInputElement)) return;
		const value = event.currentTarget.value.trim();
		const current = variant.variantProperties?.[key];
		if (value === '' || value === current) {
			event.currentTarget.value = current ?? '';
			return;
		}
		setVariantValue(ctx, variant.id, key, value);
	}
</script>

{#if variant !== undefined && set !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-variant-section>
		{#each names as key (key)}
			<label class="flex items-center gap-2 text-xs" data-variant-value={key}>
				<span class="text-muted w-20 shrink-0 truncate">{key}</span>
				<input
					aria-label="Variant value {key}"
					class="bg-input border-line text-default min-w-0 flex-1 rounded-sm border px-2 py-1 text-xs outline-none"
					value={variant.variantProperties?.[key] ?? ''}
					onchange={(event) => change(event, key)}
				/>
			</label>
		{/each}
	</div>
{/if}
