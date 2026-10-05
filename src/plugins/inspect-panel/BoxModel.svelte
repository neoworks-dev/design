<script lang="ts">
	import type { BoxModel } from '../../lib/codegen/boxModel';

	let { box }: { box: BoxModel } = $props();

	const padded = $derived(
		box.padding.top + box.padding.right + box.padding.bottom + box.padding.left > 0
	);
</script>

<!-- Nested boxes: border around padding around the content size. -->
<div
	class="border-line bg-input flex flex-col items-center gap-1 rounded-md border p-2 text-[10px]"
	data-box-model
>
	<span class="text-faint">border {box.border}</span>
	<div class="border-line flex w-full flex-col items-center gap-1 rounded border border-dashed p-2">
		{#if padded}
			<span class="text-faint" data-box-padding>
				padding {box.padding.top}
				{box.padding.right}
				{box.padding.bottom}
				{box.padding.left}
			</span>
		{/if}
		<div
			class="bg-raised text-default flex h-10 w-full items-center justify-center rounded text-xs tabular-nums"
		>
			{box.width} x {box.height}
		</div>
	</div>
</div>
