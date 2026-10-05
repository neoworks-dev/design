<script lang="ts">
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { topLevelFrameIds } from './frames';

	const ctx = getKernel();

	const LABEL_HEIGHT = 18;

	interface Label {
		id: string;
		name: string;
		/** A main component or component set: shown in the component colour with a diamond. */
		component: boolean;
		x: number;
		y: number;
		maxWidth: number;
	}

	const labels = $derived.by((): Label[] => {
		const camera = ctx.viewport.camera;
		return topLevelFrameIds(ctx).map((id) => {
			const bounds = ctx.document.absoluteBounds(id);
			const node = ctx.document.require(id);
			return {
				id,
				name: node.name,
				component: node.type === 'COMPONENT' || node.type === 'COMPONENT_SET',
				x: bounds.x * camera.scale + camera.x,
				y: bounds.y * camera.scale + camera.y - LABEL_HEIGHT,
				maxWidth: Math.max(24, bounds.width * camera.scale)
			};
		});
	});
	const selectedIds = $derived(ctx.selection.ids);
</script>

<!-- Names above top-level frames; clicking one selects that frame. -->
{#each labels as label (label.id)}
	<button
		type="button"
		class="pointer-events-auto absolute flex items-center gap-1 text-left text-xs leading-[18px]"
		class:text-violet={label.component}
		class:text-accent={!label.component && selectedIds.includes(label.id)}
		class:text-muted={!label.component && !selectedIds.includes(label.id)}
		data-frame-label={label.id}
		style:left="{label.x}px"
		style:top="{label.y}px"
		style:max-width="{label.maxWidth}px"
		onclick={() => ctx.selection.select([label.id])}
	>
		{#if label.component}<DiamondIcon size={11} weight="fill" class="shrink-0" />{/if}
		<span class="truncate">{label.name}</span>
	</button>
{/each}
