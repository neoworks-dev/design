<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { imageOutline, imageSizeOf } from '../../lib/editing/imageCrop';
	import { isPositioned } from '../../lib/editing/selectionOps';
	import type { CropState } from './cropTool.svelte';

	let { state }: { state: CropState } = $props();

	const ctx = getKernel();

	// The whole image, dashed, as it lies under the node's box.
	const outline = $derived.by(() => {
		const id = state.nodeId;
		if (id === null) return null;
		const node = ctx.document.get(id);
		if (node === undefined || !isPositioned(node)) return null;
		const image = imageSizeOf(ctx.document.reader, node);
		if (image === undefined) return null;
		const corners = imageOutline(node, ctx.document.absoluteTransform(id), image);
		if (corners === null) return null;
		return corners.map((corner) => ctx.viewport.worldToScreen(corner));
	});
</script>

{#if outline}
	<svg class="absolute inset-0 h-full w-full overflow-visible" data-crop-outline>
		<polygon
			class="text-blue-500"
			points={outline.map((point) => `${point.x},${point.y}`).join(' ')}
			fill="none"
			stroke="currentColor"
			stroke-width="1"
			stroke-dasharray="4 3"
		/>
	</svg>
{/if}
