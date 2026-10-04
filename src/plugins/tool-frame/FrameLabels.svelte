<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { topLevelFrameIds } from './frames';

	const ctx = getKernel();

	const LABEL_HEIGHT = 18;

	interface Label {
		id: string;
		name: string;
		x: number;
		y: number;
		maxWidth: number;
	}

	const labels = $derived.by((): Label[] => {
		const camera = ctx.viewport.camera;
		return topLevelFrameIds(ctx).map((id) => {
			const bounds = ctx.document.absoluteBounds(id);
			return {
				id,
				name: ctx.document.require(id).name,
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
		class="pointer-events-auto absolute truncate text-left text-xs leading-[18px]"
		class:text-accent={selectedIds.includes(label.id)}
		class:text-muted={!selectedIds.includes(label.id)}
		data-frame-label={label.id}
		style:left="{label.x}px"
		style:top="{label.y}px"
		style:max-width="{label.maxWidth}px"
		onclick={() => ctx.selection.select([label.id])}
	>
		{label.name}
	</button>
{/each}
