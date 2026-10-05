<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	interface Outline {
		id: string;
		name: string;
		x: number;
		y: number;
		width: number;
		height: number;
		selected: boolean;
	}

	const outlines = $derived.by((): Outline[] => {
		const camera = ctx.viewport.camera;
		const selectedIds = ctx.selection.ids;
		return ctx.document
			.query((node) => node.type === 'SLICE' && node.visible, ctx.document.currentPageId)
			.map((node) => {
				const bounds = ctx.document.absoluteBounds(node.id);
				return {
					id: node.id,
					name: node.name,
					x: bounds.x * camera.scale + camera.x,
					y: bounds.y * camera.scale + camera.y,
					width: bounds.width * camera.scale,
					height: bounds.height * camera.scale,
					selected: selectedIds.includes(node.id)
				};
			});
	});
</script>

<!-- Slices do not render: a dashed outline marks the export region; the label selects it. -->
{#each outlines as outline (outline.id)}
	<div
		class={[
			'border-accent pointer-events-none absolute border border-dashed',
			outline.selected && 'bg-accent/10'
		]}
		data-slice-outline={outline.id}
		style:left="{outline.x}px"
		style:top="{outline.y}px"
		style:width="{outline.width}px"
		style:height="{outline.height}px"
	></div>
	<button
		type="button"
		class="text-accent pointer-events-auto absolute truncate text-left text-xs leading-[18px]"
		data-slice-label={outline.id}
		style:left="{outline.x}px"
		style:top="{outline.y - 18}px"
		style:max-width="{Math.max(24, outline.width)}px"
		onclick={() => ctx.selection.select([outline.id])}
	>
		{outline.name}
	</button>
{/each}
