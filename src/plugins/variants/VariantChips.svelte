<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { COMPONENT_PURPLE } from '../../lib/components/labels';
	import { addVariant } from '../../lib/components/variants';
	import { getKernel } from '../../lib/kernel/context';

	// The purple "N Variants" chip above the top-right corner of every component set on the page,
	// with a plus that adds a variant. A DOM overlay like the frame labels: clicking selects the set.
	const ctx = getKernel();

	const CHIP_HEIGHT = 20;
	const CHIP_GAP = 4;

	interface Chip {
		id: string;
		count: number;
		x: number;
		y: number;
	}

	const chips = $derived.by((): Chip[] => {
		const camera = ctx.viewport.camera;
		const sets = ctx.document.children(ctx.document.currentPageId);
		return sets.flatMap((id) => {
			const node = ctx.document.get(id);
			if (node === undefined || node.type !== 'COMPONENT_SET') return [];
			const bounds = ctx.document.absoluteBounds(id);
			return [
				{
					id,
					count: ctx.document.children(id).length,
					x: (bounds.x + bounds.width) * camera.scale + camera.x,
					y: bounds.y * camera.scale + camera.y - CHIP_HEIGHT - CHIP_GAP
				}
			];
		});
	});
</script>

{#each chips as chip (chip.id)}
	<div
		class="pointer-events-auto absolute flex -translate-x-full items-center rounded-full text-xs whitespace-nowrap text-white"
		style:left="{chip.x}px"
		style:top="{chip.y}px"
		style:height="{CHIP_HEIGHT}px"
		style:background={COMPONENT_PURPLE}
		data-variant-chip={chip.id}
	>
		<button
			type="button"
			class="h-full rounded-l-full pr-1 pl-2.5"
			aria-label="Select component set"
			onclick={() => ctx.selection.select([chip.id])}
		>
			{chip.count === 1 ? '1 Variant' : `${chip.count} Variants`}
		</button>
		<button
			type="button"
			class="flex h-full items-center rounded-r-full pr-2 pl-1 hover:bg-white/20"
			aria-label="Add variant"
			onclick={() => addVariant(ctx, chip.id)}
		>
			<PlusIcon size={12} weight="bold" />
		</button>
	</div>
{/each}
